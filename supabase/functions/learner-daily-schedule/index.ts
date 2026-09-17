import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Function to format time from 24-hour to 12-hour format
const formatTime = (time: string): string => {
  const [hours, minutes] = time.split(":");
  let period = "AM";
  let hourNum = parseInt(hours);

  if (hourNum >= 12) {
    period = "PM";
    if (hourNum > 12) {
      hourNum -= 12;
    }
  }

  if (hourNum === 0) {
    hourNum = 12;
  }

  return `${hourNum}:${minutes} ${period}`;
};

const formatScheduleDate = (date: string): string => {
  const [year, month, day] = date.split("-");
  const monthName = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][Number(month) - 1];

  return `${day} ${monthName} ${year}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("MY_SUPABASE_URL") ?? "",
      Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Calculate the next day's date
    const nextDay = new Date();
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayString = nextDay.toISOString().split("T")[0]; // Format as YYYY-MM-DD

    // First, get all learners who have schedules for tomorrow
    const { data: learnersWithSchedules, error: learnersError } =
      await supabaseClient
        .from("Schedule")
        .select(`learner_id`)
        .eq("date", nextDayString)
        .neq("status", "paused")
        .order("learner_id");

    if (learnersError) {
      throw learnersError;
    }

    // Extract unique learner IDs
    const uniqueLearnerIds = [
      ...new Set(learnersWithSchedules.map((s) => s.learner_id)),
    ];

    if (uniqueLearnerIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No learners have schedules for tomorrow.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    // Process each learner
    const results = [];

    for (const learner_id of uniqueLearnerIds) {
      // Fetch tomorrow's schedules and the learner receiving the reminder.
      const [tomorrowResult, learnerResult] = await Promise.all([
        supabaseClient
          .from("Schedule")
          .select(
            `
            *,
            Instructor (
              id_instructor,
              name,
              phone
            ),
            Lesson (
              id,
              number
            )
          `,
          )
          .eq("learner_id", learner_id)
          .eq("date", nextDayString)
          .neq("status", "paused")
          .order("start_time"),
        supabaseClient
          .from("Learner")
          .select("id, name, phone")
          .eq("id", learner_id)
          .single(),
      ]);

      const schedules = tomorrowResult.data;
      const learner = learnerResult.data;

      if (tomorrowResult.error || !schedules || schedules.length === 0)
        continue;
      if (learnerResult.error || !learner) continue;

      // Show every start time when a learner has more than one lesson tomorrow.
      const scheduleTimes = schedules.map((schedule) =>
        formatTime(schedule.start_time),
      );

      // Prepare the message payload
      const messagePayload = {
        messages: [
          {
            clientWaNumber: learner.phone,
            templateName: "daily_notification_schedule_",
            templateContent:
              "Hey {{1}},\n\nWe hope you’re having a great day! 😊\n\nJust a gentle reminder that your driving lesson is scheduled for tomorrow. 🚗📔 Please find the details below:\n\nDate: {{2}}\n\nTime: {{3}}\n\nDriving Buddy: {{4}}\n\nFor complete lesson details and updates, kindly check the Lane App. 🥳\n\nImportant: We kindly request you to let us know if you need any changes to tomorrow’s schedule before 7:00 PM today. This will help us plan the schedules smoothly and accommodate your request wherever possible.\n\nWe sincerely request your cooperation in informing us within the mentioned time. Requests made after 7:00 PM may be difficult to accommodate, and nominal charges may apply for late schedule changes.\n\nThank you so much for your understanding and cooperation. 🙏\n\n– Team Lane 🚗🚗",
            templateHeader: "",
            languageCode: "en",
            variables: [
              {
                type: "body",
                parameters: [
                  {
                    type: "text",
                    text: learner.name, // Parameter 1: Learner's name
                  },
                  {
                    type: "text",
                    text: formatScheduleDate(nextDayString), // Parameter 2: Date of the lesson
                  },
                  {
                    type: "text",
                    text: scheduleTimes.join(", "), // Parameter 3: Lesson start time(s)
                  },
                  {
                    type: "text",
                    text: schedules[0].Instructor.name, // Parameter 4: Driving buddy's name
                  },
                ],
              },
            ],
            messageType: "template",
            refId: `schedule-${learner.id}-${Date.now()}`,
          },
        ],
      };

      // Send WhatsApp message
      const response = await fetch("https://api.heltar.com/v1/messages/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("HELTAR_API_KEY")}`,
        },
        body: JSON.stringify(messagePayload),
      });

      const result = {
        learner_id,
        name: learner.name,
        success: response.ok,
        status: response.status,
      };

      console.log(`Message sent to learner ${learner.name}:`, result);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `Failed to send message to learner ${learner.name}: ${errorText}`,
        );
        result.error = errorText;
      }

      results.push(result);
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
