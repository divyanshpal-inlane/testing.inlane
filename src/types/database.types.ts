export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      earning_config: {
        Row: {
          id: number;
          default_per_class_rate: number;
          default_monthly_target: number;
          payout_day: string;
          leaderboard_top_n: number;
          leaderboard_bonus_amount: number;
          tip_copy: string | null;
          availability_message_template: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: number;
          default_per_class_rate?: number;
          default_monthly_target?: number;
          payout_day?: string;
          leaderboard_top_n?: number;
          leaderboard_bonus_amount?: number;
          tip_copy?: string | null;
          availability_message_template?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: number;
          default_per_class_rate?: number;
          default_monthly_target?: number;
          payout_day?: string;
          leaderboard_top_n?: number;
          leaderboard_bonus_amount?: number;
          tip_copy?: string | null;
          availability_message_template?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      instructor_earning_settings: {
        Row: {
          instructor_id: string;
          per_class_rate: number | null;
          monthly_class_target: number | null;
          updated_at: string | null;
        };
        Insert: {
          instructor_id: string;
          per_class_rate?: number | null;
          monthly_class_target?: number | null;
          updated_at?: string | null;
        };
        Update: {
          instructor_id?: string;
          per_class_rate?: number | null;
          monthly_class_target?: number | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      earning_program: {
        Row: {
          id: string;
          key: string;
          title: string;
          description: string | null;
          amount_label: string | null;
          status_pill: string;
          cta_label: string | null;
          cta_url: string | null;
          icon_bg: string | null;
          is_active: boolean;
          sort_order: number;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          key: string;
          title: string;
          description?: string | null;
          amount_label?: string | null;
          status_pill?: string;
          cta_label?: string | null;
          cta_url?: string | null;
          icon_bg?: string | null;
          is_active?: boolean;
          sort_order?: number;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          key?: string;
          title?: string;
          description?: string | null;
          amount_label?: string | null;
          status_pill?: string;
          cta_label?: string | null;
          cta_url?: string | null;
          icon_bg?: string | null;
          is_active?: boolean;
          sort_order?: number;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      instructor_payout: {
        Row: {
          id: string;
          instructor_id: string;
          period_start: string;
          period_end: string;
          classes_count: number;
          per_class_rate: number;
          gross_amount: number;
          adjustments_total: number;
          net_amount: number;
          status: string;
          payout_date: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          instructor_id: string;
          period_start: string;
          period_end: string;
          classes_count?: number;
          per_class_rate?: number;
          gross_amount?: number;
          adjustments_total?: number;
          net_amount?: number;
          status?: string;
          payout_date?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          instructor_id?: string;
          period_start?: string;
          period_end?: string;
          classes_count?: number;
          per_class_rate?: number;
          gross_amount?: number;
          adjustments_total?: number;
          net_amount?: number;
          status?: string;
          payout_date?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      instructor_earning_adjustment: {
        Row: {
          id: string;
          instructor_id: string;
          payout_id: string | null;
          type: string;
          amount: number;
          reason: string | null;
          effective_date: string;
          created_by: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          instructor_id: string;
          payout_id?: string | null;
          type?: string;
          amount: number;
          reason?: string | null;
          effective_date: string;
          created_by?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          instructor_id?: string;
          payout_id?: string | null;
          type?: string;
          amount?: number;
          reason?: string | null;
          effective_date?: string;
          created_by?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      instructor_leave_request: {
        Row: {
          id: string;
          instructor_id: string;
          leave_type: string;
          from_date: string;
          to_date: string;
          all_day: boolean;
          start_time: string | null;
          end_time: string | null;
          reason: string | null;
          status: string;
          admin_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          unavailability_applied: boolean;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          instructor_id: string;
          leave_type?: string;
          from_date: string;
          to_date: string;
          all_day?: boolean;
          start_time?: string | null;
          end_time?: string | null;
          reason?: string | null;
          status?: string;
          admin_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          unavailability_applied?: boolean;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          instructor_id?: string;
          leave_type?: string;
          from_date?: string;
          to_date?: string;
          all_day?: boolean;
          start_time?: string | null;
          end_time?: string | null;
          reason?: string | null;
          status?: string;
          admin_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          unavailability_applied?: boolean;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      schedule_no_show: {
        Row: {
          id: string;
          schedule_id: number;
          no_show_party: string;
          reported_by: string;
          reporter_instructor_id: string | null;
          note: string | null;
          status: string;
          resolution: string | null;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          schedule_id: number;
          no_show_party: string;
          reported_by?: string;
          reporter_instructor_id?: string | null;
          note?: string | null;
          status?: string;
          resolution?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          schedule_id?: number;
          no_show_party?: string;
          reported_by?: string;
          reporter_instructor_id?: string | null;
          note?: string | null;
          status?: string;
          resolution?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      support_ticket: {
        Row: {
          id: string;
          raised_by_role: string;
          instructor_id: string | null;
          category: string;
          priority: string;
          subject: string | null;
          description: string | null;
          status: string;
          admin_response: string | null;
          assigned_to: string | null;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          raised_by_role?: string;
          instructor_id?: string | null;
          category?: string;
          priority?: string;
          subject?: string | null;
          description?: string | null;
          status?: string;
          admin_response?: string | null;
          assigned_to?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          raised_by_role?: string;
          instructor_id?: string | null;
          category?: string;
          priority?: string;
          subject?: string | null;
          description?: string | null;
          status?: string;
          admin_response?: string | null;
          assigned_to?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      safety_incident: {
        Row: {
          id: string;
          instructor_id: string;
          incident_type: string;
          schedule_id: number | null;
          description: string | null;
          location: string | null;
          status: string;
          admin_response: string | null;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          instructor_id: string;
          incident_type: string;
          schedule_id?: number | null;
          description?: string | null;
          location?: string | null;
          status?: string;
          admin_response?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          instructor_id?: string;
          incident_type?: string;
          schedule_id?: number | null;
          description?: string | null;
          location?: string | null;
          status?: string;
          admin_response?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      KAM: {
        Row: {
          id: string;
          name: string;
          phone: string | null;
          email: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          phone?: string | null;
          email?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          phone?: string | null;
          email?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      kam_instructor: {
        Row: {
          kam_id: string;
          instructor_id: string;
          assigned_at: string | null;
        };
        Insert: {
          kam_id: string;
          instructor_id: string;
          assigned_at?: string | null;
        };
        Update: {
          kam_id?: string;
          instructor_id?: string;
          assigned_at?: string | null;
        };
        Relationships: [];
      };
      Admin: {
        Row: {
          created_at: string | null;
          id: string | null;
          name: string | null;
          password: string;
          phone: string;
          signed_up: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string | null;
          name?: string | null;
          password: string;
          phone: string;
          signed_up?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string | null;
          name?: string | null;
          password?: string;
          phone?: string;
          signed_up?: string | null;
        };
        Relationships: [];
      };
      Courses: {
        Row: {
          code: number | null;
          created_at: string;
          duration: number | null;
          enabled: boolean | null;
          id: string;
          name: string | null;
          price: number | null;
          total_lessons: number | null;
        };
        Insert: {
          code?: number | null;
          created_at?: string;
          duration?: number | null;
          enabled?: boolean | null;
          id?: string;
          name?: string | null;
          price?: number | null;
          total_lessons?: number | null;
        };
        Update: {
          code?: number | null;
          created_at?: string;
          duration?: number | null;
          enabled?: boolean | null;
          id?: string;
          name?: string | null;
          price?: number | null;
          total_lessons?: number | null;
        };
        Relationships: [];
      };
      enrollment: {
        Row: {
          amount: number | null;
          course_id: string;
          created_at: string;
          id: string;
          installment_mode: string | null;
          installment1_amount: number | null;
          installment2_amount: number | null;
          learner_id: string;
          payment_id: string | null;
          payment_status: string | null;
          progress: Json;
          status: Database["public"]["Enums"]["enrollment_status"];
          unlocked_lessons: number[] | null;
          updated_at: string;
        };
        Insert: {
          amount?: number | null;
          course_id: string;
          created_at?: string;
          id?: string;
          installment_mode?: string | null;
          installment1_amount?: number | null;
          installment2_amount?: number | null;
          learner_id: string;
          payment_id?: string | null;
          payment_status?: string | null;
          progress?: Json;
          status?: Database["public"]["Enums"]["enrollment_status"];
          unlocked_lessons?: number[] | null;
          updated_at?: string;
        };
        Update: {
          amount?: number | null;
          course_id?: string;
          created_at?: string;
          id?: string;
          installment_mode?: string | null;
          installment1_amount?: number | null;
          installment2_amount?: number | null;
          learner_id?: string;
          payment_id?: string | null;
          payment_status?: string | null;
          progress?: Json;
          status?: Database["public"]["Enums"]["enrollment_status"];
          unlocked_lessons?: number[] | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "enrollment_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "Courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enrollment_learner_id_fkey";
            columns: ["learner_id"];
            isOneToOne: false;
            referencedRelation: "Learner";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enrollment_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payment";
            referencedColumns: ["id"];
          },
        ];
      };
      Instructor: {
        Row: {
          address: string | null;
          areas: string[];
          car_fuel_type:
            | Database["public"]["Enums"]["car_fuel_type_new"]
            | null;
          car_license: string | null;
          car_make: string | null;
          car_mode: string | null;
          car_number: string | null;
          created_at: string;
          DL_number: string | null;
          email: string | null;
          enabled: boolean | null;
          experience: number | null;
          id_instructor: string;
          latitude: number | null;
          longitude: number | null;
          name: string | null;
          password: string | null;
          phone: string | null;
          radius: number | null;
          signed_up: string | null;
          status: string;
          unavailability: Json | null;
        };
        Insert: {
          address?: string | null;
          areas?: string[];
          car_fuel_type?:
            | Database["public"]["Enums"]["car_fuel_type_new"]
            | null;
          car_license?: string | null;
          car_make?: string | null;
          car_mode?: string | null;
          car_number?: string | null;
          created_at?: string;
          DL_number?: string | null;
          email?: string | null;
          enabled?: boolean | null;
          experience?: number | null;
          id_instructor?: string;
          latitude?: number | null;
          longitude?: number | null;
          name?: string | null;
          password?: string | null;
          phone?: string | null;
          radius?: number | null;
          signed_up?: string | null;
          status?: string;
          unavailability?: Json | null;
        };
        Update: {
          address?: string | null;
          areas?: string[];
          car_fuel_type?:
            | Database["public"]["Enums"]["car_fuel_type_new"]
            | null;
          car_license?: string | null;
          car_make?: string | null;
          car_mode?: string | null;
          car_number?: string | null;
          created_at?: string;
          DL_number?: string | null;
          email?: string | null;
          enabled?: boolean | null;
          experience?: number | null;
          id_instructor?: string;
          latitude?: number | null;
          longitude?: number | null;
          name?: string | null;
          password?: string | null;
          phone?: string | null;
          radius?: number | null;
          signed_up?: string | null;
          status?: string;
          unavailability?: Json | null;
        };
        Relationships: [];
      };
      instructor_status_log: {
        Row: {
          id: string;
          instructor_id: string;
          old_status: string | null;
          new_status: string;
          changed_by: string | null;
          changed_at: string;
        };
        Insert: {
          id?: string;
          instructor_id: string;
          old_status?: string | null;
          new_status: string;
          changed_by?: string | null;
          changed_at?: string;
        };
        Update: {
          id?: string;
          instructor_id?: string;
          old_status?: string | null;
          new_status?: string;
          changed_by?: string | null;
          changed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "instructor_status_log_instructor_id_fkey";
            columns: ["instructor_id"];
            isOneToOne: false;
            referencedRelation: "Instructor";
            referencedColumns: ["id_instructor"];
          },
        ];
      };
      "Instructor Unavailability": {
        Row: {
          booked_date: string | null;
          booked_end_time: string | null;
          booked_start_time: string | null;
          instructor_id: string;
        };
        Insert: {
          booked_date?: string | null;
          booked_end_time?: string | null;
          booked_start_time?: string | null;
          instructor_id: string;
        };
        Update: {
          booked_date?: string | null;
          booked_end_time?: string | null;
          booked_start_time?: string | null;
          instructor_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "Instructor Unavailability_instructor_id_fkey";
            columns: ["instructor_id"];
            isOneToOne: true;
            referencedRelation: "Instructor";
            referencedColumns: ["id_instructor"];
          },
        ];
      };
      Learner: {
        Row: {
          aadhar_state: string | null;
          address_lat: number | null;
          address_lng: number | null;
          area: string | null;
          car_intent_planning: string | null;
          car_intent_type: string | null;
          car_intent_condition: string | null;
          car_intent_timeframe: string | null;
          car_intent_source: string | null;
          car_intent_updated_at: string | null;
          car_onboarding_intent_at: string | null;
          car_purchase_timeline: string | null;
          city: string | null;
          comments: string | null;
          created_at: string;
          driving_motivation: string | null;
          DL_id: string | null;
          DL_result: boolean | null;
          DL_test_date: string | null;
          DL_received: boolean | null;
          DL_received_date: string | null;
          dob: string | null;
          email: string | null;
          enabled: boolean | null;
          has_a_DL: boolean | null;
          address_change_required: boolean | null;
          has_two_wheeler_license: boolean | null;
          id: string;
          LL_application_approved: boolean | null;
          LL_approved_date: string | null;
          LL_application_id: string | null;
          LL_received: boolean | null;
          LL_received_date: date | null;
          LL_result: boolean | null;
          LL_team_appointment_booked: boolean | null;
          LL_test_date: string | null;
          is_LL_form_filled?: boolean | null;
          has_lesson10_booked: boolean | null;
          has_postLL_done?: boolean | null;
          name: string | null;
          needs_scheduling: boolean | null;
          onboarding_completed: boolean | null;
          signature_storage_path: string | null;
          signature_submitted_at: string | null;
          signature_consent_at: string | null;
          signature_terms_version: string | null;
          signature_privacy_version: string | null;
          signature_purpose: string | null;
          signature_method: string | null;
          signature_mime_type: string | null;
          password: string | null;
          phone: string;
          pick_up_location: string | null;
          pincode: string | null;
          preferred_completion_days: number | null;
          preferred_start_date: string | null;
          prefers_two_hour_classes: boolean | null;
          two_hour_days?: string | null;
          signed_up: string | null;
          start_date: string | null;
          unavailability: Json | null;
        };
        Insert: {
          aadhar_state?: string | null;
          address_lat?: number | null;
          address_lng?: number | null;
          area?: string | null;
          car_intent_planning?: string | null;
          car_intent_type?: string | null;
          car_intent_condition?: string | null;
          car_intent_timeframe?: string | null;
          car_intent_source?: string | null;
          car_intent_updated_at?: string | null;
          car_onboarding_intent_at?: string | null;
          car_purchase_timeline?: string | null;
          city?: string | null;
          comments?: string | null;
          created_at?: string;
          driving_motivation?: string | null;
          DL_id?: string | null;
          DL_result?: boolean | null;
          DL_test_date?: string | null;
          dob?: string | null;
          email?: string | null;
          enabled?: boolean | null;
          has_a_DL?: boolean | null;
          address_change_required: boolean | null;
          has_two_wheeler_license: boolean | null;
          id?: string;
          LL_application_approved?: boolean | null;
          LL_application_id?: string | null;
          LL_received?: boolean | null;
          LL_result?: boolean | null;
          LL_team_appointment_booked?: boolean | null;
          LL_test_date?: string | null;
          is_LL_form_filled?: boolean | null;
          has_postLL_done: boolean | null;
          name?: string | null;
          needs_scheduling?: boolean | null;
          onboarding_completed?: boolean | null;
          signature_storage_path?: string | null;
          signature_submitted_at?: string | null;
          signature_consent_at?: string | null;
          signature_terms_version?: string | null;
          signature_privacy_version?: string | null;
          signature_purpose?: string | null;
          signature_method?: string | null;
          signature_mime_type?: string | null;
          password?: string | null;
          phone: string;
          pick_up_location?: string | null;
          pincode?: string | null;
          preferred_completion_days?: number | null;
          preferred_start_date?: string | null;
          prefers_two_hour_classes?: boolean | null;
          two_hour_days?: string | null;
          signed_up?: string | null;
          start_date?: string | null;
          unavailability?: Json | null;
        };
        Update: {
          aadhar_state?: string | null;
          address_lat?: number | null;
          address_lng?: number | null;
          area?: string | null;
          car_intent_planning?: string | null;
          car_intent_type?: string | null;
          car_intent_condition?: string | null;
          car_intent_timeframe?: string | null;
          car_intent_source?: string | null;
          car_intent_updated_at?: string | null;
          car_onboarding_intent_at?: string | null;
          car_purchase_timeline?: string | null;
          city?: string | null;
          comments?: string | null;
          created_at?: string;
          driving_motivation?: string | null;
          DL_id?: string | null;
          DL_result?: boolean | null;
          DL_test_date?: string | null;
          dob?: string | null;
          email?: string | null;
          enabled?: boolean | null;
          has_a_DL?: boolean | null;
          address_change_required: boolean | null;
          has_two_wheeler_license: boolean | null;
          id?: string;
          LL_application_approved?: boolean | null;
          LL_application_id?: string | null;
          LL_received?: boolean | null;
          LL_result?: boolean | null;
          LL_team_appointment_booked?: boolean | null;
          LL_test_date?: string | null;
          is_LL_form_filled?: boolean | null;
          has_postLL_done: boolean | null;
          name?: string | null;
          needs_scheduling?: boolean | null;
          onboarding_completed?: boolean | null;
          signature_storage_path?: string | null;
          signature_submitted_at?: string | null;
          signature_consent_at?: string | null;
          signature_terms_version?: string | null;
          signature_privacy_version?: string | null;
          signature_purpose?: string | null;
          signature_method?: string | null;
          signature_mime_type?: string | null;
          password?: string | null;
          phone?: string;
          pick_up_location?: string | null;
          pincode?: string | null;
          preferred_completion_days?: number | null;
          preferred_start_date?: string | null;
          prefers_two_hour_classes?: boolean | null;
          two_hour_days?: string | null;
          signed_up?: string | null;
          start_date?: string | null;
          unavailability?: Json | null;
          has_lesson10_booked: boolean | null;
        };
        Relationships: [];
      };
      "Learner Availability": {
        Row: {
          day_of_the_week: string | null;
          learner_id: string;
          list_of_available_timeslots: Json | null;
        };
        Insert: {
          day_of_the_week?: string | null;
          learner_id: string;
          list_of_available_timeslots?: Json | null;
        };
        Update: {
          day_of_the_week?: string | null;
          learner_id?: string;
          list_of_available_timeslots?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "Learner Availability_learner_id_fkey";
            columns: ["learner_id"];
            isOneToOne: true;
            referencedRelation: "Learner";
            referencedColumns: ["id"];
          },
        ];
      };
      Lesson: {
        Row: {
          course_id: string | null;
          created_at: string;
          description: string | null;
          duration: number | null;
          enabled: boolean | null;
          id: string;
          number: number | null;
        };
        Insert: {
          course_id?: string | null;
          created_at?: string;
          description?: string | null;
          duration?: number | null;
          enabled?: boolean | null;
          id?: string;
          number?: number | null;
        };
        Update: {
          course_id?: string | null;
          created_at?: string;
          description?: string | null;
          duration?: number | null;
          enabled?: boolean | null;
          id?: string;
          number?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "Lesson_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "Courses";
            referencedColumns: ["id"];
          },
        ];
      };
      payment: {
        Row: {
          amount: number;
          created_at: string;
          email: string | null;
          gateway_reference: string | null;
          id: string;
          installment_type: string | null;
          installment1_amount: number | null;
          installment2_amount: number | null;
          learner_id: string;
          name: string | null;
          parent_payment_id: string | null;
          payment_type: Database["public"]["Enums"]["payment_type"];
          phone: string | null;
          status: string;
          total_amount: number | null;
          updated_at: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          email?: string | null;
          gateway_reference?: string | null;
          id?: string;
          installment_type?: string | null;
          installment1_amount?: number | null;
          installment2_amount?: number | null;
          learner_id: string;
          name?: string | null;
          parent_payment_id?: string | null;
          payment_type: Database["public"]["Enums"]["payment_type"];
          phone?: string | null;
          status?: string;
          total_amount?: number | null;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          email?: string | null;
          gateway_reference?: string | null;
          id?: string;
          installment_type?: string | null;
          installment1_amount?: number | null;
          installment2_amount?: number | null;
          learner_id?: string;
          name?: string | null;
          parent_payment_id?: string | null;
          payment_type?: Database["public"]["Enums"]["payment_type"];
          phone?: string | null;
          status?: string;
          total_amount?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_learner_id_fkey";
            columns: ["learner_id"];
            isOneToOne: false;
            referencedRelation: "Learner";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_parent_payment_id_fkey";
            columns: ["parent_payment_id"];
            isOneToOne: false;
            referencedRelation: "payment";
            referencedColumns: ["id"];
          },
        ];
      };
      reschedule_requests: {
        Row: {
          amount: number;
          created_at: string | null;
          id: string;
          learner_id: string;
          lesson_ids: string[];
          payment_id: string | null;
          status: Database["public"]["Enums"]["reschedule_request_status"];
          type: Database["public"]["Enums"]["reschedule_request_type"];
          updated_at: string | null;
        };
        Insert: {
          amount?: number;
          created_at?: string | null;
          id?: string;
          learner_id: string;
          lesson_ids: string[];
          payment_id?: string | null;
          status?: Database["public"]["Enums"]["reschedule_request_status"];
          type?: Database["public"]["Enums"]["reschedule_request_type"];
          updated_at?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string | null;
          id?: string;
          learner_id?: string;
          lesson_ids?: string[];
          payment_id?: string | null;
          status?: Database["public"]["Enums"]["reschedule_request_status"];
          type?: Database["public"]["Enums"]["reschedule_request_type"];
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "reschedule_requests_learner_id_fkey";
            columns: ["learner_id"];
            isOneToOne: false;
            referencedRelation: "Learner";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reschedule_requests_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payment";
            referencedColumns: ["id"];
          },
        ];
      };
      Schedule: {
        Row: {
          calendar_sequence: number | null;
          calendar_uid: string | null;
          course_id: string | null;
          created_at: string;
          date: string;
          enabled: boolean;
          end_time: string;
          id: number;
          instructor_id: string | null;
          learner_id: string | null;
          lesson_id: string | null;
          otp: string | null;
          otp_end: string | null;
          start_time: string;
          status: string | null;
          isTentative: boolean | null;
          leadName: string | null;
          started_at: string | null;
          ended_at: string | null;
        };
        Insert: {
          calendar_sequence?: number | null;
          calendar_uid?: string | null;
          course_id?: string | null;
          created_at?: string;
          date: string;
          enabled?: boolean;
          end_time: string;
          id?: number;
          instructor_id?: string | null;
          learner_id?: string | null;
          lesson_id?: string | null;
          otp?: string | null;
          otp_end: string | null;
          start_time: string;
          status?: string | null;
          isTentative: boolean | null;
          leadName: string | null;
          started_at: string | null;
          ended_at: string | null;
        };
        Update: {
          calendar_sequence?: number | null;
          calendar_uid?: string | null;
          course_id?: string | null;
          created_at?: string;
          date?: string;
          enabled?: boolean;
          end_time?: string;
          id?: number;
          instructor_id?: string | null;
          learner_id?: string | null;
          lesson_id?: string | null;
          otp?: string | null;
          otp_end: string | null;
          start_time?: string;
          status?: string | null;
          isTentative: boolean | null;
          leadName: string | null;
          started_at: string | null;
          ended_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "Schedule_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "Courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "Schedule_instructor_id_fkey";
            columns: ["instructor_id"];
            isOneToOne: false;
            referencedRelation: "Instructor";
            referencedColumns: ["id_instructor"];
          },
          {
            foreignKeyName: "Schedule_learner_id_fkey";
            columns: ["learner_id"];
            isOneToOne: false;
            referencedRelation: "Learner";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "Schedule_lesson_id_fkey";
            columns: ["lesson_id"];
            isOneToOne: false;
            referencedRelation: "Lesson";
            referencedColumns: ["id"];
          },
        ];
      };
      schedule_preferences: {
        Row: {
          created_at: string;
          day_of_week: number;
          id: string;
          learner_id: string;
          time_slot: Database["public"]["Enums"]["time_slot"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          day_of_week: number;
          id?: string;
          learner_id: string;
          time_slot: Database["public"]["Enums"]["time_slot"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          day_of_week?: number;
          id?: string;
          learner_id?: string;
          time_slot?: Database["public"]["Enums"]["time_slot"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "schedule_preferences_learner_id_fkey";
            columns: ["learner_id"];
            isOneToOne: false;
            referencedRelation: "Learner";
            referencedColumns: ["id"];
          },
        ];
      };
      Serviceable_Areas: {
        Row: {
          active: boolean | null;
          created_at: string | null;
          id: string;
          name: string;
          updated_at: string | null;
        };
        Insert: {
          active?: boolean | null;
          created_at?: string | null;
          id?: string;
          name: string;
          updated_at?: string | null;
        };
        Update: {
          active?: boolean | null;
          created_at?: string | null;
          id?: string;
          name?: string;
          updated_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_earnings_instructors: {
        Args: { p_search?: string };
        Returns: {
          id_instructor: string;
          name: string | null;
          phone: string | null;
        }[];
      get_course_feedback: {
        Args: { search_term: string; checkpoint_filter: string };
        Returns: {
          id: string;
          enrollment_id: string;
          learner_id: string;
          checkpoint: string;
          overall_rating: number;
          instructor_rating: number;
          course_rating: number;
          comment: string | null;
          created_at: string;
        }[];
      };
      get_course_feedback_stats: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      get_learners_with_issues: {
        Args: { search_term: string; issue_filter: string };
        Returns: Database["public"]["Tables"]["Learner"]["Row"][];
      };
      record_learning_session: {
        Args: {
          p_session_id: string;
          p_course_id: string;
          p_lesson_number: number;
          p_content_id: string;
          p_sequence: number;
          p_snapshot: Json;
        };
        Returns: undefined;
      };
      get_learning_analytics: {
        Args: {
          p_search: string;
          p_activity: string;
          p_course_id: string | null;
          p_lesson_number: number | null;
          p_page: number;
        };
        Returns: Json;
      };
      get_learning_attempts: {
        Args: {
          p_learner_id: string;
          p_course_id: string;
          p_lesson_number: number;
          p_content_id: string;
          p_page: number;
        };
        Returns: Json;
      };
      record_game_launch: {
        Args: { p_event_id: string; p_game_id: string };
        Returns: undefined;
      };
      get_game_analytics: {
        Args: {
          p_search: string;
          p_game_id: string;
          p_activity: string;
          p_page: number;
        };
        Returns: Json;
      };
      get_game_analytics_by_learner: {
        Args: {
          p_search: string;
          p_game_id: string;
          p_activity: string;
          p_page: number;
        };
        Returns: Json;
      };
      calculate_reschedule_fee: {
        Args: {
          lesson_ids: string[];
        };
        Returns: number;
      };
      delete_claim: {
        Args: {
          uid: string;
          claim: string;
        };
        Returns: string;
      };
      get_claim: {
        Args: {
          uid: string;
          claim: string;
        };
        Returns: Json;
      };
      get_claims: {
        Args: {
          uid: string;
        };
        Returns: Json;
      };
      get_my_claim: {
        Args: {
          claim: string;
        };
        Returns: Json;
      };
      get_my_claims: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      is_claims_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_within_72_hours: {
        Args: {
          schedule_date: string;
          schedule_time: string;
        };
        Returns: boolean;
      };
      set_claim: {
        Args: {
          uid: string;
          claim: string;
          value: Json;
        };
        Returns: string;
      };
    };
    Enums: {
      car_fuel_type: "petrol" | "diesel" | "ev" | "hybrid";
      car_fuel_type_new: "petrol" | "diesel" | "ev" | "cng" | "lpg";
      enrollment_status: "pending" | "active" | "completed" | "cancelled";
      payment_type: "course" | "reschedule";
      reschedule_request_status:
        | "pending_payment"
        | "pending"
        | "completed"
        | "cancelled";
      reschedule_request_type: "new" | "reschedule" | "lesson10";
      time_slot: "6-9" | "9-12" | "12-15" | "15-18" | "18-21";
      type: "new" | "reschedule" | "lesson10";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database[Extract<keyof Database, "public">];

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never;
