import { Game } from "@/components/lesson/trivia";
import { LESSON_TRIVIA } from "@/constants/lessonTrivia";

export const LESSON_IDS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
] as const;

export type LessonContent = Record<
  string,
  {
    id: string;
    description: string;
    image_path: string;
    content: {
      game1?: Game;
      game?: Game;
      title?: string;
      points?: { icon: React.ReactNode; header: string; desc: string }[];
      remember?: { icon: React.ReactNode; text: string }[];
    };
    menu?: {
      trivia?: { title: string; icon: string; color: string };
      video?: {
        title: string;
        icon: string;
        color: string;
        video_path: string;
      }[];
      signature?: { title: string; icon: string; color: string };
    };
  }
>;

export const LESSON_CONTENT: LessonContent = {
  "1": {
    id: "1",
    description: "Get to know your car",
    image_path: "/assets/lesson-pic-1.png",
    menu: {
      trivia: {
        title: "You drove into a quiz",
        icon: "🤖",
        color: "bg-purple-400",
      },
      video: [
        {
          title: "Public Relations for Drivers",
          icon: "🤝",
          color: "bg-blue-500",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/PUBLIC%20RELATIONS%20FOR%20DRIVERS.mp4",
        },
        {
          title: "3 seconds is all it takes",
          icon: "⏰",
          color: "bg-[#6257FF]",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/2-1.mp4",
        },
      ],
    },
    content: {
      remember: [
        { icon: "😊", text: "Think of your car as your best buddy " },
        {
          icon: "👨🏻‍💼",
          text: "Every pro driver has good control of the car - drive slowly ",
        },
        { icon: "🚗", text: "Keep it chill, under 20 km/h" },
        {
          icon: "🚧",
          text: "Distance - give obstacles some personal space",
        },
      ],
      title: "You will be good at Starting & Stopping the Car",
      points: [
        {
          icon: "gears.svg",
          header: "Car Intro:",
          desc: "Dashboard, gears, controls",
        },
        {
          icon: "seat.svg",
          header: "Get Comfy:",
          desc: "Adjust seat, mirrors, steering",
        },
        {
          icon: "ignition.svg",
          header: "Start Up:",
          desc: "Clutch, neutral, turn the key",
        },
        {
          icon: "pedals.svg",
          header: "Move Forward:",
          desc: "Balance clutch & accelerator",
        },
        {
          icon: "brakes.svg",
          header: "Stop Smoothly:",
          desc: "Press brake and then clutch for quick stops",
        },
      ],
      game: LESSON_TRIVIA["1"],
    },
  },
  "2": {
    id: "2",
    description: "Balancing the pedals",
    image_path: "/assets/lesson-pic-2.png",
    menu: {
      trivia: {
        title: "You drove into a quiz",
        icon: "🤖",
        color: "bg-purple-400",
      },
      video: [
        {
          title: "3 seconds is all it takes",
          icon: "⏰",
          color: "bg-[#6257FF]",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/2-1.mp4",
        },
        {
          title: "slay slopes like a pro",
          icon: "🔥",
          color: "bg-[#D9FF7A]",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/2-2.mp4",
        },
      ],
    },
    content: {
      remember: [
        { icon: "🏎", text: "Keep it chill, under 20 km/h" },
        { icon: "🚧", text: "Distance - Give obstacles some personal space" },
        { icon: "😊", text: "Treat your car like your best buddy" },
      ],
      title: "You will start getting the hang of balancing the pedals",

      points: [
        {
          icon: "forward.svg",
          header: "Pedal Fun:",
          desc: "Drive forward & back on a straight road",
        },
        {
          icon: "stop.svg",
          header: "Stop & Go:",
          desc: "Quick stops, smooth moves (emergency stops)",
        },
        {
          icon: "slope.svg",
          header: "Slope Magic:",
          desc: "Balancing pedals on slopes",
        },
        {
          icon: "mirror.svg",
          header: "Mirror Magic:",
          desc: "Grasping the surrounding",
        },
      ],

      game: LESSON_TRIVIA["2"],
    },
  },
  "3": {
    id: "3",
    description: "Gears & Steering Control",
    image_path: "/assets/lesson-pic-3.png",
    menu: {
      trivia: {
        title: "clueless about gears",
        icon: "🤔",
        color: "bg-purple-400",
      },
      video: [
        {
          title: "When to change Gears?",
          icon: "⚙️",
          color: "bg-[#D9FF7A]",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/3-1.mp4",
        },
        {
          title: "Turn Like a Champ!",
          icon: "↩️",
          color: "bg-[#00CE84]",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/3-2.mp4",
        },
      ],
    },
    content: {
      remember: [
        {
          icon: "🍫",
          text: "Find the Sweet Spot - Nail the clutch biting point",
        },
        {
          icon: "🚘",
          text: "Slow pace - To sharpen steering skills",
        },
        {
          icon: "💡",
          text: "Use indicators before turns",
        },
      ],
      title: "You will start changing gears and practicing turns",
      points: [
        {
          icon: "gears.svg",
          header: "Gearbox Magic:",
          desc: "Nail the clutch and shift gears smoothly",
        },
        {
          icon: "steering.svg",
          header: "Steering Skills:",
          desc: "Hold the wheel right, move smoothly",
        },
        {
          icon: "rightturn.svg",
          header: "Turn Tricks:",
          desc: "Slow down, signal, and check mirrors",
        },
      ],
      game: LESSON_TRIVIA["3"],
    },
  },
  "4": {
    id: "4",
    description: "Parking",
    image_path: "/assets/lesson-pic-4.png",
    menu: {
      trivia: {
        title: "let’s brake for trivia!",
        icon: "⚙️",
        color: "bg-purple-400",
      },
      video: [
        {
          title: "perpendicular parking",
          icon: "🚗",
          color: "bg-[#D9FF7A]",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/4-1.mp4",
        },
        {
          title: "parallel parking",
          icon: "👀",
          color: "bg-blue-500",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/4-2.mp4",
        },
      ],
    },
    content: {
      remember: [
        {
          icon: "🅿️",
          text: "Be slow while parking - check mirrors & signals",
        },
        {
          icon: "⚙️",
          text: "Steer smoothly",
        },
        {
          icon: "🚗",
          text: "Press the clutch completely - release slow & accelerate",
        },
      ],
      title: "You will find parking not so tough anymore",

      points: [
        {
          icon: "parking.svg",
          header: "Find Your Fit:",
          desc: "Spot spaces and align perfectly",
        },
        {
          icon: "mirror.svg",
          header: "Mirror Magic:",
          desc: "Judge distance and avoid bumper kisses",
        },
        {
          icon: "steering.svg",
          header: "Slow Steering:",
          desc: "Navigate tight spots with ease",
        },
        {
          icon: "vlc.svg",
          header: "Park and Exit:",
          desc: "Right gear & safely open doors",
        },
        {
          icon: "gears.svg",
          header: "Gear Up:",
          desc: "Balance pedals and gear in slow movements",
        },
      ],
      game: LESSON_TRIVIA["4"],
    },
  },
  "5": {
    id: "5",
    description: "Driving at steady speed",
    image_path: "/assets/lesson-pic-5.png",
    menu: {
      trivia: {
        title: "screen time, before drive time",
        icon: "🤖",
        color: "bg-purple-400",
      },
      video: [
        {
          title: "pause, bump, then go!",
          icon: "🛑",
          color: "bg-[#00CE84]",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/5.mp4",
        },
      ],
    },
    content: {
      remember: [
        {
          icon: "🛣",
          text: "Adjust speed to road conditions",
        },
        {
          icon: "🎛",
          text: "Gear Guru - Shift by engine sound or RPM",
        },
        {
          icon: "⚙️",
          text: "Release clutch slowly with gentle acceleration",
        },
      ],
      title: "You will drive on main roads for the first time",

      points: [
        {
          icon: "pedals.svg",
          header: "Steady Speed:",
          desc: "1. On straight roads & turns \n 2. Speed control using brakes",
        },
        {
          icon: "gears.svg",
          header: "Gear Shifting:",
          desc: "Without looking",
        },
        {
          icon: "parking.svg",
          header: "Parking Pro:",
          desc: "Parallel park SLIDE!",
        },
      ],
      game: LESSON_TRIVIA["5"],
    },
  },
  "6": {
    id: "6",
    description: "Hitting the main road",
    image_path: "/assets/lesson-pic-6.png",
    menu: {
      trivia: {
        title: "lane change challenge",
        icon: "🤓",
        color: "bg-purple-400",
      },
      video: [
        {
          title: "signal, check, then move!",
          icon: "🛣️",
          color: "bg-[#D9FF7A]",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/6.mp4",
        },
      ],
    },
    content: {
      remember: [
        {
          icon: "💡",
          text: "Use indicators for lane changes",
        },
        {
          icon: "🚥",
          text: "Traffic Ninja - Keep an eye on the traffic at all times",
        },
        {
          icon: "🚗",
          text: "Speed Maestro - Adjust speed to match conditions",
        },
      ],
      title: "You will start to drive at steady speeds on main roads",

      points: [
        {
          icon: "mirror.svg",
          header: "Mirror Magic:",
          desc: "Anticipating others actions ",
        },
        {
          icon: "gaps.svg",
          header: "Safe Gaps:",
          desc: "Keep a safe distance from other vehicles",
        },
        {
          icon: "uturn.svg",
          header: "Sign Savvy:",
          desc: "Know your traffic signs",
        },
        {
          icon: "fog-lamp.svg",
          header: "Blinker Sense:",
          desc: "Use indicators to communicate",
        },
        {
          icon: "highway.svg",
          header: "Lane Loyalty:",
          desc: "Maintain your lane",
        },
      ],
      game: LESSON_TRIVIA["6"],
    },
  },
  "7": {
    id: "7",
    description: "Bumper to bumper traffic",
    image_path: "/assets/lesson-pic-7.png",
    menu: {
      trivia: {
        title: "test your know-how",
        icon: "🍀",
        color: "bg-purple-400",
      },
      video: [
        {
          title: "U-turn Tutorial",
          icon: "↩️",
          color: "bg-blue-500",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/U-turn%20tutorial.mp4",
        },
        {
          title: "Roudabout rules",
          icon: "📷",
          color: "bg-yellow-500",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/7-1.mp4",
        },
        {
          title: "Crossroad control",
          icon: "🚦",
          color: "bg-orange-500",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/7-2.mp4",
        },
      ],
    },
    content: {
      remember: [
        {
          icon: "🚥",
          text: "Keep a sharp eye on traffic, pedestrians, and surprises",
        },
        {
          icon: "🚨",
          text: "Use signals early to keep everyone aware",
        },
        {
          icon: "⚙️",
          text: "Anticipate gear changes in time",
        },
      ],
      title: "You will begin to enjoy driving on city roads",

      points: [
        {
          icon: "traffic-light.svg",
          header: "Smooth Moves:",
          desc: "Stop & start at traffic signals",
        },
        {
          icon: "speedometer.svg",
          header: "Speed Sense:",
          desc: "Judge and keep the right speed and distance",
        },
        {
          icon: "cityscape.svg",
          header: "City Maze:",
          desc: "Roundabouts & Intersections Know who goes first",
        },
        {
          icon: "fog-lamp.svg",
          header: "Signal Master:",
          desc: "Use indicators to communicate",
        },
        {
          icon: "slopedes.svg",
          header: "Slope Savvy:",
          desc: "Low gear more power & control",
        },
      ],

      game: LESSON_TRIVIA["7"],
    },
  },
  "8": {
    id: "8",
    description: "City driving",
    image_path: "/assets/lesson-pic-8.png",
    menu: {
      trivia: {
        title: "twilight trivia time",
        icon: "🌅",
        color: "bg-purple-400",
      },
      video: [
        {
          title: "Headlights & High Beams",
          icon: "🔥",
          color: "bg-[#00CE84]",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/8.mp4",
        },
      ],
    },
    content: {
      remember: [
        {
          icon: "🛣",
          text: "All eyes on the road - zero distraction",
        },
        {
          icon: "💡",
          text: "Don’t forget to use indicator and horn to let others know of your action",
        },
      ],
      title: "You will start believing in your driving skills",

      points: [
        {
          icon: "speedometer.svg",
          header: "Speed Sense:",
          desc: "Judge and keep the right speed and distance",
        },
        {
          icon: "fog-lamp.svg",
          header: "Using indicators:",
          desc: "Communicate well with others",
        },
        {
          icon: "slope.svg",
          header: "Slope Savvy:",
          desc: "Low gear more power & control",
        },
        {
          icon: "parking.svg",
          header: "Parking Pro:",
          desc: "Practice makes perfect",
        },
      ],
      game: LESSON_TRIVIA["8"],
    },
  },
  "9": {
    id: "9",
    description: "Comfortable with flyovers",
    image_path: "/assets/lesson-pic-9.png",
    menu: {
      trivia: {
        title: "flyover flow facts",
        icon: "⚙️",
        color: "bg-purple-400",
      },
      video: [
        {
          title: "pass like a pro",
          icon: "👀",
          color: "bg-[#D9FF7A]",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/9.mp4",
        },
      ],
    },
    content: {
      remember: [
        {
          icon: "🏎",
          text: "Drive at consistent speeds",
        },
        {
          icon: "👨🏻‍💼",
          text: "Every pro driver has good control of the car - drive slowly",
        },
        {
          icon: "😊",
          text: "Treat your car like your best buddy",
        },
      ],
      title: "You will drive at consistent speeds on a flyover",
      points: [
        {
          icon: "flyover-bridge.svg",
          header: "Flyover Flow:",
          desc: "Merge and exit at the right speeds",
        },
        {
          icon: "highway.svg",
          header: "Lane Glider:",
          desc: "Signal, check, and change lanes smoothly",
        },
        {
          icon: "traffic-light.svg",
          header: "Flyover Traffic:",
          desc: "Become comfortable in driving on flyover traffic",
        },
        {
          icon: "smartphone-call.svg",
          header: "Tech-Savvy Driver:",
          desc: "Using GPS without distractions",
        },
      ],
      game: LESSON_TRIVIA["9"],
    },
  },
  "10": {
    id: "10",
    description: "Mini challenges",
    image_path: "/assets/lesson-pic-10.png",
    menu: {
      video: [
        {
          title: "First Aid for Drivers",
          icon: "🩹",
          color: "bg-red-500",
          video_path:
            "https://inlane-lesson-content.s3.ap-south-1.amazonaws.com/First%20Aid%20for%20Drivers.mp4",
        },
      ],
      trivia: {
        title: "You drove into a quiz",
        icon: "🤖",
        color: "bg-purple-400",
      },
      signature: {
        title: "Sign your completion",
        icon: "✍️",
        color: "bg-[#00CE84]",
      },
    },
    content: {
      game: LESSON_TRIVIA["10"],
      remember: [
        {
          icon: "🏎",
          text: "Drive at consistent speeds",
        },
        {
          icon: "👨🏻‍💼",
          text: "Every pro driver has good control of the car - drive slowly",
        },
        {
          icon: "😊",
          text: "Treat your car like your best buddy",
        },
      ],
      title: "You will have an absolutely fun time doing the challenges",
      points: [
        {
          icon: "ignition.svg",
          header: "Mini challenges:",
          desc: "Practice on manoeuvres and brush and brush up your driving skills",
        },
        {
          icon: "calm.svg",
          header: "Zen Mode:",
          desc: "Tips to stay relaxed & focused",
        },
      ],
    },
  },
};
