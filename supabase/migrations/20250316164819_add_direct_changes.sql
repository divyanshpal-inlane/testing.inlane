create type "public"."type" as enum ('new', 'reschedule', 'lesson10');

drop policy "Enable read access for all users" on "public"."Courses";

alter table "public"."Admin" drop constraint "Admin_pkey";

drop index if exists "public"."Admin_pkey";

alter table "public"."Admin" add column "password" text;

alter table "public"."Admin" alter column "created_at" drop not null;

alter table "public"."Admin" alter column "id" drop not null;

alter table "public"."Admin" alter column "name" drop not null;

alter table "public"."Lesson" alter column "duration" set default '1'::bigint;

alter table "public"."Lesson" alter column "enabled" set default true;

alter table "public"."Schedule" alter column "status" set default 'booked'::text;

alter table "public"."enrollment" add column "amount" bigint;

alter table "public"."enrollment" add column "installment1_amount" numeric(10,2);

alter table "public"."enrollment" add column "installment2_amount" numeric(10,2);

alter table "public"."enrollment" add column "installment_mode" text default 'full'::text;

alter table "public"."enrollment" add column "payment_status" text;

alter table "public"."enrollment" add column "unlocked_lessons" integer[] default '{}'::integer[];

alter table "public"."payment" add column "installment1_amount" numeric(10,2);

alter table "public"."payment" add column "installment2_amount" numeric(10,2);

alter table "public"."payment" add column "installment_type" text default 'full'::text;

alter table "public"."payment" add column "name" text;

alter table "public"."payment" add column "parent_payment_id" uuid;

alter table "public"."payment" add column "total_amount" numeric(10,2);

ALTER TABLE "public"."reschedule_requests" 
ALTER COLUMN "type" SET DEFAULT 'reschedule'::reschedule_request_type;


ALTER TABLE "public"."reschedule_requests" 
ALTER COLUMN "type" 
SET DATA TYPE reschedule_request_type 
USING "type"::text::reschedule_request_type;



CREATE INDEX idx_enrollment_installment_mode ON public.enrollment USING btree (installment_mode);

CREATE INDEX idx_enrollment_payment_status ON public.enrollment USING btree (payment_status);

CREATE INDEX idx_payment_installment_type ON public.payment USING btree (installment_type);

CREATE UNIQUE INDEX "Admin_pkey" ON public."Admin" USING btree (phone);

alter table "public"."Admin" add constraint "Admin_pkey" PRIMARY KEY using index "Admin_pkey";

alter table "public"."payment" add constraint "payment_installment_type_check" CHECK ((installment_type = ANY (ARRAY['full'::text, 'first_half'::text, 'second_half'::text]))) not valid;

alter table "public"."payment" validate constraint "payment_installment_type_check";

alter table "public"."payment" add constraint "payment_parent_payment_id_fkey" FOREIGN KEY (parent_payment_id) REFERENCES payment(id) not valid;

alter table "public"."payment" validate constraint "payment_parent_payment_id_fkey";

create policy "Enable read access for all users"
on "public"."enrollment"
as permissive
for select
to public
using (true);


create policy "Enable read access for all users"
on "public"."Courses"
as permissive
for select
to public
using (true);



