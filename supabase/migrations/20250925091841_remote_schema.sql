

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'All performance indexes have been dropped - only primary keys and unique constraints remain';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE SCHEMA IF NOT EXISTS "pgmq";
CREATE EXTENSION IF NOT EXISTS "pgmq" WITH SCHEMA "pgmq";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."create_schedule_override"("p_original_schedule_id" "uuid", "p_override_user_id" "text", "p_override_reason" "text", "p_created_by" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    original_schedule RECORD;
    override_schedule_id UUID;
BEGIN
    -- Get original schedule details
    SELECT os.*
    INTO original_schedule
    FROM oncall_schedules os
    WHERE os.id = p_original_schedule_id AND os.is_active = true;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Original schedule not found or inactive: %', p_original_schedule_id;
    END IF;
    
    -- Deactivate original schedule
    UPDATE oncall_schedules 
    SET is_active = false, updated_at = NOW()
    WHERE id = p_original_schedule_id;
    
    -- Create override schedule
    INSERT INTO oncall_schedules (
        rotation_cycle_id,
        group_id,
        user_id,
        schedule_type,
        start_time,
        end_time,
        is_active,
        is_recurring,
        rotation_days,
        created_at,
        updated_at,
        created_by,
        is_override,
        original_user_id,
        override_reason
    ) VALUES (
        original_schedule.rotation_cycle_id,
        original_schedule.group_id,
        p_override_user_id,
        original_schedule.schedule_type,
        original_schedule.start_time,
        original_schedule.end_time,
        true,
        false, -- Overrides are not recurring
        original_schedule.rotation_days,
        NOW(),
        NOW(),
        p_created_by,
        true, -- This is an override
        original_schedule.user_id, -- Original user
        p_override_reason
    ) RETURNING id INTO override_schedule_id;
    
    RETURN override_schedule_id;
END;
$$;


ALTER FUNCTION "public"."create_schedule_override"("p_original_schedule_id" "uuid", "p_override_user_id" "text", "p_override_reason" "text", "p_created_by" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_rotation_schedules"("rotation_cycle_id_param" "uuid", "weeks_ahead_param" integer DEFAULT 52) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    cycle_record RECORD;
    member_order_array TEXT[];
    shift_date DATE;
    current_member_index INTEGER := 0;
    member_id TEXT;
    shift_start_time TIMESTAMP WITH TIME ZONE;
    shift_end_time TIMESTAMP WITH TIME ZONE;
    schedules_created INTEGER := 0;
    total_days INTEGER;
    current_day INTEGER := 0;
BEGIN
    -- Get rotation cycle details
    SELECT 
        group_id, rotation_type, rotation_days, start_date, 
        start_time, end_time, member_order::text[]
    INTO cycle_record
    FROM rotation_cycles 
    WHERE id = rotation_cycle_id_param AND is_active = true;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Rotation cycle not found or inactive: %', rotation_cycle_id_param;
    END IF;
    
    -- Parse member order array
    member_order_array := cycle_record.member_order;
    
    IF array_length(member_order_array, 1) IS NULL OR array_length(member_order_array, 1) = 0 THEN
        RAISE EXCEPTION 'No members found in rotation cycle';
    END IF;
    
    -- Calculate total days to generate
    total_days := weeks_ahead_param * 7;
    shift_date := cycle_record.start_date;
    
    -- Generate schedules for each rotation period
    WHILE current_day < total_days LOOP
        -- Get current member
        member_id := member_order_array[(current_member_index % array_length(member_order_array, 1)) + 1];
        
        -- Calculate shift start and end times
        shift_start_time := (shift_date + cycle_record.start_time::TIME)::TIMESTAMP WITH TIME ZONE;
        shift_end_time := (shift_date + INTERVAL '1 day' * cycle_record.rotation_days - INTERVAL '1 minute' + cycle_record.end_time::TIME)::TIMESTAMP WITH TIME ZONE;
        
        -- Insert schedule record
        INSERT INTO oncall_schedules (
            group_id,
            user_id,
            schedule_type,
            start_time,
            end_time,
            is_active,
            is_recurring,
            rotation_days,
            rotation_cycle_id,
            created_at,
            updated_at,
            created_by
        ) VALUES (
            cycle_record.group_id,
            member_id::UUID,
            cycle_record.rotation_type,
            shift_start_time,
            shift_end_time,
            true,
            false, -- Individual shifts are not recurring
            cycle_record.rotation_days,
            rotation_cycle_id_param,
            NOW(),
            NOW(),
            'system'
        );
        
        schedules_created := schedules_created + 1;
        
        -- Move to next rotation period
        shift_date := shift_date + INTERVAL '1 day' * cycle_record.rotation_days;
        current_day := current_day + cycle_record.rotation_days;
        current_member_index := current_member_index + 1;
    END LOOP;
    
    RETURN schedules_created;
END;
$$;


ALTER FUNCTION "public"."generate_rotation_schedules"("rotation_cycle_id_param" "uuid", "weeks_ahead_param" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."generate_rotation_schedules"("rotation_cycle_id_param" "uuid", "weeks_ahead_param" integer) IS 'Generates rotation schedules automatically based on rotation cycle configuration. 
Returns the number of schedules created.';



CREATE OR REPLACE FUNCTION "public"."get_current_oncall_user"("p_group_id" "uuid") RETURNS TABLE("schedule_id" "uuid", "user_id" "text", "user_name" "text", "user_email" "text", "start_time" timestamp without time zone, "end_time" timestamp without time zone)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        os.id as schedule_id,
        os.user_id,
        u.name as user_name,
        u.email as user_email,
        os.start_time,
        os.end_time
    FROM oncall_schedules os
    JOIN users u ON os.user_id = u.id
    WHERE os.group_id = p_group_id
      AND os.is_active = true
      AND NOW() BETWEEN os.start_time AND os.end_time
    ORDER BY os.start_time
    LIMIT 1;
END;
$$;


ALTER FUNCTION "public"."get_current_oncall_user"("p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_rotation_member"("p_rotation_cycle_id" "uuid") RETURNS TABLE("user_id" "text", "user_name" "text", "user_email" "text", "schedule_start" timestamp with time zone, "schedule_end" timestamp with time zone, "is_override" boolean, "override_reason" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        os.user_id,
        u.name as user_name,
        u.email as user_email,
        os.start_time as schedule_start,
        os.end_time as schedule_end,
        os.is_override,
        os.override_reason
    FROM oncall_schedules os
    JOIN users u ON os.user_id = u.id
    WHERE os.rotation_cycle_id = p_rotation_cycle_id
      AND os.is_active = true
      AND NOW() BETWEEN os.start_time AND os.end_time
    ORDER BY os.start_time
    LIMIT 1;
END;
$$;


ALTER FUNCTION "public"."get_current_rotation_member"("p_rotation_cycle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_integration_health_status"("integration_uuid" "uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    last_beat TIMESTAMP WITH TIME ZONE;
    interval_seconds INTEGER;
    status TEXT;
BEGIN
    SELECT last_heartbeat, heartbeat_interval 
    INTO last_beat, interval_seconds
    FROM integrations 
    WHERE id = integration_uuid;
    
    IF last_beat IS NULL THEN
        RETURN 'unknown';
    END IF;
    
    IF last_beat < NOW() - INTERVAL '1 second' * (interval_seconds * 2) THEN
        RETURN 'unhealthy';
    ELSIF last_beat < NOW() - INTERVAL '1 second' * interval_seconds THEN
        RETURN 'warning';
    ELSE
        RETURN 'healthy';
    END IF;
END;
$$;


ALTER FUNCTION "public"."get_integration_health_status"("integration_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_upcoming_oncall_schedules"("p_group_id" "uuid", "p_days" integer DEFAULT 7) RETURNS TABLE("schedule_id" "uuid", "user_id" "text", "user_name" "text", "user_email" "text", "start_time" timestamp without time zone, "end_time" timestamp without time zone, "schedule_type" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        os.id as schedule_id,
        os.user_id,
        u.name as user_name,
        u.email as user_email,
        os.start_time,
        os.end_time,
        os.schedule_type
    FROM oncall_schedules os
    JOIN users u ON os.user_id = u.id
    WHERE os.group_id = p_group_id
      AND os.is_active = true
      AND os.start_time BETWEEN NOW() AND (NOW() + (p_days || ' days')::INTERVAL)
    ORDER BY os.start_time;
END;
$$;


ALTER FUNCTION "public"."get_upcoming_oncall_schedules"("p_group_id" "uuid", "p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_incident_assigned_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- On INSERT: Set assigned_at if assigned_to is provided
    IF TG_OP = 'INSERT' THEN
        IF NEW.assigned_to IS NOT NULL AND NEW.assigned_at IS NULL THEN
            NEW.assigned_at = NOW() AT TIME ZONE 'UTC';
        END IF;
    END IF;

    -- On UPDATE: Handle assigned_to changes
    IF TG_OP = 'UPDATE' THEN
        -- If assigned_to changed from NULL to something, set assigned_at
        IF OLD.assigned_to IS NULL AND NEW.assigned_to IS NOT NULL THEN
            NEW.assigned_at = NOW() AT TIME ZONE 'UTC';
        END IF;

        -- If assigned_to changed to NULL, clear assigned_at
        IF OLD.assigned_to IS NOT NULL AND NEW.assigned_to IS NULL THEN
            NEW.assigned_at = NULL;
        END IF;

        -- If assigned_to changed to different user, update assigned_at
        IF OLD.assigned_to IS NOT NULL AND NEW.assigned_to IS NOT NULL
           AND OLD.assigned_to != NEW.assigned_to THEN
            NEW.assigned_at = NOW() AT TIME ZONE 'UTC';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_incident_assigned_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_alerts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_alerts_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_escalation_policies_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_escalation_policies_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_groups_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_groups_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_incidents_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_incidents_updated_at"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_incidents_updated_at"() IS 'Automatically updates updated_at to UTC time on incidents table updates';



CREATE OR REPLACE FUNCTION "public"."update_integration_heartbeat"("integration_uuid" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    UPDATE integrations 
    SET last_heartbeat = NOW() 
    WHERE id = integration_uuid AND is_active = true;
    
    RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."update_integration_heartbeat"("integration_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_notification_configs_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_notification_configs_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_oncall_schedules_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_oncall_schedules_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_rotation_cycles_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_rotation_cycles_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_services_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_services_updated_at"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_services_updated_at"() IS 'Automatically updates updated_at to UTC time on services table updates';



CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_users_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_users_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."alert_escalations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "alert_id" "text" NOT NULL,
    "rule_id" "uuid" NOT NULL,
    "level_number" integer NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "escalated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "acknowledged_at" timestamp without time zone,
    "acknowledged_by" "text",
    "response_time_seconds" integer,
    "notification_methods" "text"[] DEFAULT '{}'::"text"[],
    "error_message" "text",
    CONSTRAINT "valid_escalation_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text", 'acknowledged'::"text", 'timeout'::"text"])))
);


ALTER TABLE "public"."alert_escalations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alert_routing_tables" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true,
    "priority" integer DEFAULT 50,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "created_by" "text"
);


ALTER TABLE "public"."alert_routing_tables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT ("now"() AT TIME ZONE 'UTC'::"text") NOT NULL,
    "updated_at" timestamp without time zone DEFAULT ("now"() AT TIME ZONE 'UTC'::"text") NOT NULL,
    "severity" "text",
    "source" "text",
    "acked_by" "text",
    "acked_at" timestamp without time zone,
    "code" "text",
    "count" integer,
    "author" "text",
    "assigned_to" "uuid" DEFAULT "gen_random_uuid"(),
    "assigned_at" timestamp without time zone,
    "current_escalation_level" integer DEFAULT 0,
    "last_escalated_at" timestamp without time zone,
    "escalation_status" "text" DEFAULT 'none'::"text",
    "escalation_rule_id" "uuid",
    CONSTRAINT "valid_escalation_status" CHECK (("escalation_status" = ANY (ARRAY['none'::"text", 'pending'::"text", 'escalating'::"text", 'completed'::"text", 'stopped'::"text"])))
);


ALTER TABLE "public"."alerts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedule_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "original_schedule_id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "new_user_id" "uuid" NOT NULL,
    "override_reason" "text",
    "override_type" "text",
    "override_start_time" timestamp with time zone NOT NULL,
    "override_end_time" timestamp with time zone NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "text"
);


ALTER TABLE "public"."schedule_overrides" OWNER TO "postgres";


COMMENT ON TABLE "public"."schedule_overrides" IS 'Stores override assignments for oncall schedules. 
Allows temporary or permanent reassignment of on-call duties to different users.';



CREATE TABLE IF NOT EXISTS "public"."shifts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "shift_type" "text" NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_recurring" boolean DEFAULT false NOT NULL,
    "rotation_days" integer DEFAULT 0 NOT NULL,
    "rotation_cycle_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "text",
    "service_id" "uuid",
    "is_override" boolean,
    "scheduler_id" "uuid"
);


ALTER TABLE "public"."shifts" OWNER TO "postgres";


COMMENT ON TABLE "public"."shifts" IS 'Stores on-call schedule assignments for users within groups. 
Supports both manual schedules and auto-generated rotation schedules.';



COMMENT ON COLUMN "public"."shifts"."service_id" IS 'Service ID for service-specific schedules. NULL for group-wide schedules.';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "role" "text" NOT NULL,
    "team" "text" NOT NULL,
    "fcm_token" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp without time zone NOT NULL,
    "updated_at" timestamp without time zone NOT NULL,
    "provider" "text",
    "provider_id" "uuid" NOT NULL
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."effective_schedules" AS
 SELECT "os"."id" AS "schedule_id",
    "os"."group_id",
    COALESCE("so"."new_user_id", "os"."user_id") AS "effective_user_id",
    "os"."shift_type" AS "schedule_type",
    "os"."start_time",
    "os"."end_time",
    "os"."is_active",
    "os"."is_recurring",
    "os"."rotation_days",
    "os"."rotation_cycle_id",
    "so"."id" AS "override_id",
    "so"."override_reason",
    "so"."override_type",
        CASE
            WHEN ("so"."id" IS NOT NULL) THEN true
            ELSE false
        END AS "is_overridden",
        CASE
            WHEN (("so"."id" IS NOT NULL) AND ("so"."override_start_time" = "os"."start_time") AND ("so"."override_end_time" = "os"."end_time")) THEN true
            ELSE false
        END AS "is_full_override",
    COALESCE("ou"."name", "u"."name") AS "effective_user_name",
    COALESCE("ou"."email", "u"."email") AS "effective_user_email",
    COALESCE("ou"."team", "u"."team") AS "effective_user_team",
    "os"."user_id" AS "original_user_id",
    "u"."name" AS "original_user_name",
    "u"."email" AS "original_user_email",
    "u"."team" AS "original_user_team",
    "ou"."name" AS "override_user_name",
    "ou"."email" AS "override_user_email",
    "ou"."team" AS "override_user_team",
    "so"."override_start_time",
    "so"."override_end_time",
    "os"."created_at",
    "os"."updated_at",
    "os"."created_by"
   FROM ((("public"."shifts" "os"
     JOIN "public"."users" "u" ON (("os"."user_id" = "u"."id")))
     LEFT JOIN "public"."schedule_overrides" "so" ON ((("os"."id" = "so"."original_schedule_id") AND ("so"."is_active" = true) AND (("now"() >= "so"."override_start_time") AND ("now"() <= "so"."override_end_time")))))
     LEFT JOIN "public"."users" "ou" ON (("so"."new_user_id" = "ou"."id")));


ALTER VIEW "public"."effective_schedules" OWNER TO "postgres";


COMMENT ON VIEW "public"."effective_schedules" IS 'Provides effective schedule information with overrides applied. 
Combines oncall_schedules, schedule_overrides, and user information 
to show who is actually on-call at any given time.';



CREATE TABLE IF NOT EXISTS "public"."escalation_levels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "policy_id" "uuid" NOT NULL,
    "level_number" integer NOT NULL,
    "target_type" character varying NOT NULL,
    "target_id" "uuid",
    "timeout_minutes" integer DEFAULT 5 NOT NULL,
    "notification_methods" "jsonb" DEFAULT '["email"]'::"jsonb",
    "message_template" "text" DEFAULT 'Alert: {{alert.title}} requires attention'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "escalation_levels_level_number_positive" CHECK (("level_number" > 0)),
    CONSTRAINT "escalation_levels_target_type_valid" CHECK ((("target_type")::"text" = ANY ((ARRAY['current_schedule'::character varying, 'user'::character varying, 'group'::character varying, 'external'::character varying, 'scheduler'::character varying])::"text"[]))),
    CONSTRAINT "escalation_levels_timeout_valid" CHECK ((("timeout_minutes" > 0) AND ("timeout_minutes" <= 1440)))
);


ALTER TABLE "public"."escalation_levels" OWNER TO "postgres";


COMMENT ON TABLE "public"."escalation_levels" IS 'Individual steps in an escalation chain';



CREATE TABLE IF NOT EXISTS "public"."escalation_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "repeat_max_times" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "group_id" "uuid",
    "created_by" "text",
    "escalate_after_minutes" integer DEFAULT 5,
    CONSTRAINT "escalation_policies_name_not_empty" CHECK (("length"(TRIM(BOTH FROM "name")) > 0)),
    CONSTRAINT "escalation_policies_repeat_max_valid" CHECK ((("repeat_max_times" >= 0) AND ("repeat_max_times" <= 10)))
);


ALTER TABLE "public"."escalation_policies" OWNER TO "postgres";


COMMENT ON TABLE "public"."escalation_policies" IS 'Datadog-style escalation policies defining multi-level escalation chains';



CREATE TABLE IF NOT EXISTS "public"."escalation_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "created_by" "text",
    "severity_levels" "text"[] DEFAULT '{critical,high}'::"text"[],
    "time_conditions" "jsonb" DEFAULT '{}'::"jsonb",
    "source_filters" "text"[] DEFAULT '{}'::"text"[],
    "max_escalation_levels" integer DEFAULT 3,
    "escalation_timeout" integer DEFAULT 300,
    CONSTRAINT "valid_severities" CHECK (("severity_levels" <@ ARRAY['critical'::"text", 'high'::"text", 'medium'::"text", 'low'::"text"]))
);


ALTER TABLE "public"."escalation_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."escalation_targets" (
    "id" "uuid" NOT NULL,
    "rule_id" "uuid",
    "target_type" character varying(50) NOT NULL,
    "target_id" character varying(255) NOT NULL,
    "notification_method" character varying(50) NOT NULL,
    "created_at" timestamp without time zone NOT NULL
);


ALTER TABLE "public"."escalation_targets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."group_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "escalation_order" integer DEFAULT 1,
    "notification_preferences" "jsonb" DEFAULT '{"fcm": true, "sms": false, "email": true}'::"jsonb",
    "added_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "added_by" "text",
    CONSTRAINT "valid_member_role" CHECK (("role" = ANY (ARRAY['member'::"text", 'leader'::"text", 'backup'::"text"])))
);


ALTER TABLE "public"."group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "type" "text" DEFAULT 'escalation'::"text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "escalation_timeout" integer DEFAULT 300,
    "escalation_method" "text" DEFAULT 'parallel'::"text",
    "visibility" "text" DEFAULT 'private'::"text",
    CONSTRAINT "valid_escalation_method" CHECK (("escalation_method" = ANY (ARRAY['parallel'::"text", 'sequential'::"text", 'round_robin'::"text"]))),
    CONSTRAINT "valid_group_type" CHECK (("type" = ANY (ARRAY['escalation'::"text", 'notification'::"text", 'approval'::"text"]))),
    CONSTRAINT "valid_group_visibility" CHECK (("visibility" = ANY (ARRAY['private'::"text", 'public'::"text", 'organization'::"text"])))
);


ALTER TABLE "public"."groups" OWNER TO "postgres";


COMMENT ON COLUMN "public"."groups"."visibility" IS 'Group visibility: private (members only), public (discoverable by all), organization (all org members)';



CREATE TABLE IF NOT EXISTS "public"."incident_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "event_data" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."incident_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incidents" (
    "id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'triggered'::"text" NOT NULL,
    "urgency" "text" DEFAULT 'high'::"text" NOT NULL,
    "priority" "text",
    "created_at" timestamp without time zone DEFAULT ("now"() AT TIME ZONE 'UTC'::"text") NOT NULL,
    "updated_at" timestamp without time zone DEFAULT ("now"() AT TIME ZONE 'UTC'::"text") NOT NULL,
    "assigned_to" "uuid",
    "assigned_at" timestamp without time zone,
    "acknowledged_by" "uuid",
    "acknowledged_at" timestamp without time zone,
    "resolved_by" "uuid",
    "resolved_at" timestamp without time zone,
    "source" "text" NOT NULL,
    "integration_id" "text",
    "service_id" "uuid",
    "external_id" "text",
    "external_url" "text",
    "escalation_policy_id" "uuid",
    "current_escalation_level" integer DEFAULT 0,
    "last_escalated_at" timestamp without time zone,
    "escalation_status" "text" DEFAULT 'none'::"text",
    "group_id" "uuid",
    "api_key_id" "text",
    "severity" "text",
    "incident_key" "text",
    "alert_count" integer DEFAULT 1,
    "labels" "jsonb",
    "custom_fields" "jsonb",
    CONSTRAINT "valid_escalation_status" CHECK (("escalation_status" = ANY (ARRAY['none'::"text", 'pending'::"text", 'escalating'::"text", 'completed'::"text", 'stopped'::"text"]))),
    CONSTRAINT "valid_status" CHECK (("status" = ANY (ARRAY['triggered'::"text", 'acknowledged'::"text", 'resolved'::"text"]))),
    CONSTRAINT "valid_urgency" CHECK (("urgency" = ANY (ARRAY['low'::"text", 'high'::"text"])))
);


ALTER TABLE "public"."incidents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "type" character varying(50) NOT NULL,
    "description" "text",
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "webhook_secret" character varying(255),
    "is_active" boolean DEFAULT true NOT NULL,
    "last_heartbeat" timestamp with time zone,
    "heartbeat_interval" integer DEFAULT 300,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "text",
    "webhook_url" character varying GENERATED ALWAYS AS (((('https://api.slar.io/webhook/'::"text" || ("type")::"text") || '/'::"text") || ("id")::"text")) STORED,
    CONSTRAINT "integrations_name_not_empty" CHECK (("length"(TRIM(BOTH FROM "name")) > 0)),
    CONSTRAINT "integrations_type_valid" CHECK ((("type")::"text" = ANY ((ARRAY['prometheus'::character varying, 'datadog'::character varying, 'grafana'::character varying, 'webhook'::character varying, 'aws'::character varying, 'custom'::character varying])::"text"[])))
);


ALTER TABLE "public"."integrations" OWNER TO "postgres";


COMMENT ON TABLE "public"."integrations" IS 'External monitoring integrations that send alerts to the system';



COMMENT ON COLUMN "public"."integrations"."config" IS 'JSON configuration specific to integration type (endpoints, auth, etc.)';



COMMENT ON COLUMN "public"."integrations"."webhook_secret" IS 'Secret for validating incoming webhooks';



CREATE TABLE IF NOT EXISTS "public"."notification_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "incident_id" "uuid",
    "notification_type" character varying(50) NOT NULL,
    "channel" character varying(20) NOT NULL,
    "recipient" character varying(255) NOT NULL,
    "title" character varying(255),
    "message" "text",
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "error_message" "text",
    "sent_at" timestamp with time zone,
    "retry_count" integer DEFAULT 0,
    "external_message_id" character varying(255),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notification_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."raw_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "incident_id" "uuid" DEFAULT "gen_random_uuid"(),
    "raw_payload" "jsonb" NOT NULL,
    "processed_at" timestamp without time zone,
    "dedup_key" "text",
    "fingerprint" "text",
    "source" "text" NOT NULL,
    "integration_id" "text",
    "received_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."raw_alerts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rotation_cycles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "rotation_type" "text" NOT NULL,
    "rotation_days" integer DEFAULT 7 NOT NULL,
    "start_date" timestamp with time zone NOT NULL,
    "start_time" time without time zone DEFAULT '00:00:00'::time without time zone NOT NULL,
    "end_time" time without time zone DEFAULT '23:59:00'::time without time zone NOT NULL,
    "member_order" "jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "created_by" "text",
    CONSTRAINT "valid_member_order" CHECK (("jsonb_array_length"("member_order") > 0)),
    CONSTRAINT "valid_rotation_days" CHECK (("rotation_days" > 0)),
    CONSTRAINT "valid_rotation_type" CHECK (("rotation_type" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'custom'::"text"]))),
    CONSTRAINT "valid_time_range" CHECK (("start_time" <> "end_time"))
);


ALTER TABLE "public"."rotation_cycles" OWNER TO "postgres";


COMMENT ON CONSTRAINT "valid_time_range" ON "public"."rotation_cycles" IS 'Allows same-day shifts (09:00-17:00), cross-day shifts (16:00-15:59), and 24/7 coverage (00:00-23:59)';



CREATE TABLE IF NOT EXISTS "public"."schedulers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying NOT NULL,
    "display_name" character varying,
    "group_id" "uuid" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true,
    "rotation_type" character varying DEFAULT 'manual'::character varying,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "created_by" character varying
);


ALTER TABLE "public"."schedulers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schema_migrations" (
    "version" character varying(255) NOT NULL,
    "applied_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."schema_migrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_checks" (
    "id" character varying(36) NOT NULL,
    "service_id" character varying(36) NOT NULL,
    "status" character varying(20) NOT NULL,
    "response_time_ms" integer DEFAULT 0 NOT NULL,
    "status_code" integer,
    "response_body" "text",
    "error_message" "text",
    "checked_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "ssl_expiry" timestamp without time zone,
    "ssl_issuer" character varying(255),
    "ssl_days_left" integer
);


ALTER TABLE "public"."service_checks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_incidents" (
    "id" character varying(36) NOT NULL,
    "service_id" character varying(36) NOT NULL,
    "type" character varying(30) NOT NULL,
    "status" character varying(20) DEFAULT 'ongoing'::character varying NOT NULL,
    "started_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp without time zone,
    "duration_seconds" integer,
    "description" "text" NOT NULL,
    "alert_id" character varying(36)
);


ALTER TABLE "public"."service_incidents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_id" "uuid" NOT NULL,
    "integration_id" "uuid" NOT NULL,
    "routing_conditions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "priority" integer DEFAULT 100 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "text",
    CONSTRAINT "service_integrations_priority_valid" CHECK ((("priority" >= 1) AND ("priority" <= 1000)))
);


ALTER TABLE "public"."service_integrations" OWNER TO "postgres";


COMMENT ON TABLE "public"."service_integrations" IS 'Many-to-many mapping between services and integrations with routing conditions';



COMMENT ON COLUMN "public"."service_integrations"."routing_conditions" IS 'JSON conditions for routing alerts from this integration to this service';



COMMENT ON COLUMN "public"."service_integrations"."priority" IS 'Priority for this integration when multiple integrations match (lower = higher priority)';



CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "routing_key" "text" NOT NULL,
    "escalation_rule_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'UTC'::"text") NOT NULL,
    "updated_at" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'UTC'::"text") NOT NULL,
    "created_by" "text",
    "integrations" "jsonb" DEFAULT '{}'::"jsonb",
    "notification_settings" "jsonb" DEFAULT '{}'::"jsonb",
    "escalation_policy_id" "uuid" DEFAULT "gen_random_uuid"(),
    "routing_conditions" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."services" OWNER TO "postgres";


COMMENT ON TABLE "public"."services" IS 'Stores services within groups. Each service can have its own escalation policies and scheduling.
Similar to PagerDuty services - represents different applications/systems that can generate alerts.';



COMMENT ON COLUMN "public"."services"."routing_key" IS 'Unique webhook key used to route alerts to this service. Used in alert ingestion URLs.';



COMMENT ON COLUMN "public"."services"."integrations" IS 'JSON object storing integration configurations (Datadog, Prometheus, etc.)';



COMMENT ON COLUMN "public"."services"."notification_settings" IS 'JSON object storing notification preferences for this service';



COMMENT ON COLUMN "public"."services"."routing_conditions" IS 'JSONB conditions for routing alerts to this service';



CREATE TABLE IF NOT EXISTS "public"."uptime_stats" (
    "id" character varying(36) NOT NULL,
    "service_id" character varying(36) NOT NULL,
    "period" character varying(10) NOT NULL,
    "uptime_percentage" numeric(5,2) DEFAULT 0.00 NOT NULL,
    "total_checks" integer DEFAULT 0 NOT NULL,
    "successful_checks" integer DEFAULT 0 NOT NULL,
    "failed_checks" integer DEFAULT 0 NOT NULL,
    "avg_response_time_ms" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "min_response_time_ms" integer DEFAULT 0 NOT NULL,
    "max_response_time_ms" integer DEFAULT 0 NOT NULL,
    "last_updated" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."uptime_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_notification_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "slack_user_id" character varying(50),
    "slack_channel_id" character varying(50),
    "slack_enabled" boolean DEFAULT true,
    "email_enabled" boolean DEFAULT true,
    "email_address" character varying(255),
    "sms_enabled" boolean DEFAULT false,
    "phone_number" character varying(20),
    "push_enabled" boolean DEFAULT true,
    "notification_timezone" character varying(50) DEFAULT 'UTC'::character varying,
    "quiet_hours_start" time without time zone,
    "quiet_hours_end" time without time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_notification_configs" OWNER TO "postgres";


ALTER TABLE ONLY "public"."escalation_levels"
    ADD CONSTRAINT "escalation_levels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."escalation_levels"
    ADD CONSTRAINT "escalation_levels_unique_target_per_step" UNIQUE ("policy_id", "level_number", "target_type", "target_id");



COMMENT ON CONSTRAINT "escalation_levels_unique_target_per_step" ON "public"."escalation_levels" IS 'Allows multiple targets per escalation step (parallel notification), but prevents duplicate targets in the same step. level_number represents step number, not individual target sequence.';



ALTER TABLE ONLY "public"."escalation_policies"
    ADD CONSTRAINT "escalation_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incident_events"
    ADD CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incidents"
    ADD CONSTRAINT "incidents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_name_unique" UNIQUE ("name");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_logs"
    ADD CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "oncall_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."raw_alerts"
    ADD CONSTRAINT "raw_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_overrides"
    ADD CONSTRAINT "schedule_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedulers"
    ADD CONSTRAINT "schedulers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_integrations"
    ADD CONSTRAINT "service_integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_integrations"
    ADD CONSTRAINT "service_integrations_unique" UNIQUE ("service_id", "integration_id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_routing_key_key" UNIQUE ("routing_key");



ALTER TABLE ONLY "public"."user_notification_configs"
    ADD CONSTRAINT "user_notification_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_notification_configs"
    ADD CONSTRAINT "user_notification_configs_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_key" UNIQUE ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_provider_id_key" UNIQUE ("provider_id");



CREATE INDEX "idx_escalation_levels_level_number" ON "public"."escalation_levels" USING "btree" ("policy_id", "level_number");



CREATE INDEX "idx_escalation_levels_policy_id" ON "public"."escalation_levels" USING "btree" ("policy_id");



CREATE INDEX "idx_escalation_policies_active" ON "public"."escalation_policies" USING "btree" ("is_active");



CREATE INDEX "idx_incident_events_created_at" ON "public"."incident_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_incident_events_incident_id" ON "public"."incident_events" USING "btree" ("incident_id");



CREATE INDEX "idx_incidents_assigned_to" ON "public"."incidents" USING "btree" ("assigned_to");



CREATE INDEX "idx_incidents_created_at" ON "public"."incidents" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_incidents_external_id" ON "public"."incidents" USING "btree" ("external_id");



CREATE INDEX "idx_incidents_group_id" ON "public"."incidents" USING "btree" ("group_id");



CREATE INDEX "idx_incidents_incident_key" ON "public"."incidents" USING "btree" ("incident_key");



CREATE INDEX "idx_incidents_service_id" ON "public"."incidents" USING "btree" ("service_id");



CREATE INDEX "idx_incidents_status" ON "public"."incidents" USING "btree" ("status");



CREATE INDEX "idx_notification_logs_created_at" ON "public"."notification_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notification_logs_incident_id" ON "public"."notification_logs" USING "btree" ("incident_id");



CREATE INDEX "idx_notification_logs_status" ON "public"."notification_logs" USING "btree" ("status");



CREATE INDEX "idx_notification_logs_user_id" ON "public"."notification_logs" USING "btree" ("user_id");



CREATE INDEX "idx_oncall_schedules_active" ON "public"."shifts" USING "btree" ("is_active");



CREATE INDEX "idx_oncall_schedules_group_id" ON "public"."shifts" USING "btree" ("group_id");



CREATE INDEX "idx_oncall_schedules_rotation_cycle" ON "public"."shifts" USING "btree" ("rotation_cycle_id");



CREATE INDEX "idx_oncall_schedules_service_id" ON "public"."shifts" USING "btree" ("service_id");



CREATE INDEX "idx_oncall_schedules_time_range" ON "public"."shifts" USING "btree" ("start_time", "end_time");



CREATE INDEX "idx_oncall_schedules_user_id" ON "public"."shifts" USING "btree" ("user_id");



CREATE INDEX "idx_raw_alerts_dedup_key" ON "public"."raw_alerts" USING "btree" ("dedup_key");



CREATE INDEX "idx_raw_alerts_fingerprint" ON "public"."raw_alerts" USING "btree" ("fingerprint");



CREATE INDEX "idx_raw_alerts_incident_id" ON "public"."raw_alerts" USING "btree" ("incident_id");



CREATE INDEX "idx_schedule_overrides_active" ON "public"."schedule_overrides" USING "btree" ("is_active");



CREATE INDEX "idx_schedule_overrides_group_id" ON "public"."schedule_overrides" USING "btree" ("group_id");



CREATE INDEX "idx_schedule_overrides_new_user_id" ON "public"."schedule_overrides" USING "btree" ("new_user_id");



CREATE INDEX "idx_schedule_overrides_original_schedule" ON "public"."schedule_overrides" USING "btree" ("original_schedule_id");



CREATE INDEX "idx_schedule_overrides_time_range" ON "public"."schedule_overrides" USING "btree" ("override_start_time", "override_end_time");



CREATE INDEX "idx_services_active" ON "public"."services" USING "btree" ("is_active");



CREATE INDEX "idx_services_escalation_rule" ON "public"."services" USING "btree" ("escalation_rule_id");



CREATE INDEX "idx_services_group_id" ON "public"."services" USING "btree" ("group_id");



CREATE UNIQUE INDEX "idx_services_name_per_group" ON "public"."services" USING "btree" ("group_id", "name") WHERE ("is_active" = true);



CREATE INDEX "idx_services_routing_conditions" ON "public"."services" USING "gin" ("routing_conditions");



CREATE INDEX "idx_services_routing_key" ON "public"."services" USING "btree" ("routing_key");



CREATE UNIQUE INDEX "schedulers_group_id_name_active_key" ON "public"."schedulers" USING "btree" ("group_id", "name") WHERE ("is_active" = true);



CREATE OR REPLACE TRIGGER "trigger_alerts_updated_at" BEFORE UPDATE ON "public"."alerts" FOR EACH ROW EXECUTE FUNCTION "public"."update_alerts_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_escalation_policies_updated_at" BEFORE UPDATE ON "public"."escalation_policies" FOR EACH ROW EXECUTE FUNCTION "public"."update_escalation_policies_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_groups_updated_at" BEFORE UPDATE ON "public"."groups" FOR EACH ROW EXECUTE FUNCTION "public"."update_groups_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_incident_assigned_at" BEFORE INSERT OR UPDATE ON "public"."incidents" FOR EACH ROW EXECUTE FUNCTION "public"."set_incident_assigned_at"();



CREATE OR REPLACE TRIGGER "trigger_incidents_updated_at" BEFORE UPDATE ON "public"."incidents" FOR EACH ROW EXECUTE FUNCTION "public"."update_incidents_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_rotation_cycles_updated_at" BEFORE UPDATE ON "public"."rotation_cycles" FOR EACH ROW EXECUTE FUNCTION "public"."update_rotation_cycles_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_services_updated_at" BEFORE UPDATE ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "public"."update_services_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_update_notification_configs_updated_at" BEFORE UPDATE ON "public"."user_notification_configs" FOR EACH ROW EXECUTE FUNCTION "public"."update_notification_configs_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_update_notification_logs_updated_at" BEFORE UPDATE ON "public"."notification_logs" FOR EACH ROW EXECUTE FUNCTION "public"."update_notification_configs_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_users_updated_at"();



ALTER TABLE ONLY "public"."alerts"
    ADD CONSTRAINT "alerts_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."escalation_policies"
    ADD CONSTRAINT "escalation_policies_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."escalation_levels"
    ADD CONSTRAINT "fk_escalation_levels_policy_id" FOREIGN KEY ("policy_id") REFERENCES "public"."escalation_policies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "fk_oncall_schedules_service_id" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_integrations"
    ADD CONSTRAINT "fk_service_integrations_integration" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_integrations"
    ADD CONSTRAINT "fk_service_integrations_service" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."incident_events"
    ADD CONSTRAINT "incident_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."incidents"
    ADD CONSTRAINT "incidents_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."incidents"
    ADD CONSTRAINT "incidents_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."incidents"
    ADD CONSTRAINT "incidents_escalation_policy_fkey" FOREIGN KEY ("escalation_policy_id") REFERENCES "public"."escalation_policies"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."incidents"
    ADD CONSTRAINT "incidents_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."incidents"
    ADD CONSTRAINT "incidents_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_logs"
    ADD CONSTRAINT "notification_logs_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_logs"
    ADD CONSTRAINT "notification_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "oncall_schedules_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "oncall_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedulers"
    ADD CONSTRAINT "schedulers_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_scheduler_id_fkey" FOREIGN KEY ("scheduler_id") REFERENCES "public"."schedulers"("id");



ALTER TABLE ONLY "public"."user_notification_configs"
    ADD CONSTRAINT "user_notification_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."escalation_levels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."escalation_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shifts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";















































































































































































































































































































































































































































































































GRANT ALL ON FUNCTION "public"."create_schedule_override"("p_original_schedule_id" "uuid", "p_override_user_id" "text", "p_override_reason" "text", "p_created_by" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_schedule_override"("p_original_schedule_id" "uuid", "p_override_user_id" "text", "p_override_reason" "text", "p_created_by" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_schedule_override"("p_original_schedule_id" "uuid", "p_override_user_id" "text", "p_override_reason" "text", "p_created_by" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_rotation_schedules"("rotation_cycle_id_param" "uuid", "weeks_ahead_param" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."generate_rotation_schedules"("rotation_cycle_id_param" "uuid", "weeks_ahead_param" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_rotation_schedules"("rotation_cycle_id_param" "uuid", "weeks_ahead_param" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_current_oncall_user"("p_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_current_oncall_user"("p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_oncall_user"("p_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_current_rotation_member"("p_rotation_cycle_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_current_rotation_member"("p_rotation_cycle_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_rotation_member"("p_rotation_cycle_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_integration_health_status"("integration_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_integration_health_status"("integration_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_integration_health_status"("integration_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_upcoming_oncall_schedules"("p_group_id" "uuid", "p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_upcoming_oncall_schedules"("p_group_id" "uuid", "p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_upcoming_oncall_schedules"("p_group_id" "uuid", "p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_incident_assigned_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_incident_assigned_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_incident_assigned_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_alerts_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_alerts_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_alerts_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_escalation_policies_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_escalation_policies_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_escalation_policies_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_groups_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_groups_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_groups_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_incidents_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_incidents_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_incidents_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_integration_heartbeat"("integration_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_integration_heartbeat"("integration_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_integration_heartbeat"("integration_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_notification_configs_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_notification_configs_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_notification_configs_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_oncall_schedules_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_oncall_schedules_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_oncall_schedules_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_rotation_cycles_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_rotation_cycles_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_rotation_cycles_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_services_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_services_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_services_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_users_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_users_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_users_updated_at"() TO "service_role";






























GRANT ALL ON TABLE "public"."alert_escalations" TO "anon";
GRANT ALL ON TABLE "public"."alert_escalations" TO "authenticated";
GRANT ALL ON TABLE "public"."alert_escalations" TO "service_role";



GRANT ALL ON TABLE "public"."alert_routing_tables" TO "anon";
GRANT ALL ON TABLE "public"."alert_routing_tables" TO "authenticated";
GRANT ALL ON TABLE "public"."alert_routing_tables" TO "service_role";



GRANT ALL ON TABLE "public"."alerts" TO "anon";
GRANT ALL ON TABLE "public"."alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."alerts" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_overrides" TO "anon";
GRANT ALL ON TABLE "public"."schedule_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."shifts" TO "anon";
GRANT ALL ON TABLE "public"."shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."shifts" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."effective_schedules" TO "anon";
GRANT ALL ON TABLE "public"."effective_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."effective_schedules" TO "service_role";



GRANT ALL ON TABLE "public"."escalation_levels" TO "anon";
GRANT ALL ON TABLE "public"."escalation_levels" TO "authenticated";
GRANT ALL ON TABLE "public"."escalation_levels" TO "service_role";



GRANT ALL ON TABLE "public"."escalation_policies" TO "anon";
GRANT ALL ON TABLE "public"."escalation_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."escalation_policies" TO "service_role";



GRANT ALL ON TABLE "public"."escalation_rules" TO "anon";
GRANT ALL ON TABLE "public"."escalation_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."escalation_rules" TO "service_role";



GRANT ALL ON TABLE "public"."escalation_targets" TO "anon";
GRANT ALL ON TABLE "public"."escalation_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."escalation_targets" TO "service_role";



GRANT ALL ON TABLE "public"."group_members" TO "anon";
GRANT ALL ON TABLE "public"."group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."group_members" TO "service_role";



GRANT ALL ON TABLE "public"."groups" TO "anon";
GRANT ALL ON TABLE "public"."groups" TO "authenticated";
GRANT ALL ON TABLE "public"."groups" TO "service_role";



GRANT ALL ON TABLE "public"."incident_events" TO "anon";
GRANT ALL ON TABLE "public"."incident_events" TO "authenticated";
GRANT ALL ON TABLE "public"."incident_events" TO "service_role";



GRANT ALL ON TABLE "public"."incidents" TO "anon";
GRANT ALL ON TABLE "public"."incidents" TO "authenticated";
GRANT ALL ON TABLE "public"."incidents" TO "service_role";



GRANT ALL ON TABLE "public"."integrations" TO "anon";
GRANT ALL ON TABLE "public"."integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."integrations" TO "service_role";



GRANT ALL ON TABLE "public"."notification_logs" TO "anon";
GRANT ALL ON TABLE "public"."notification_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_logs" TO "service_role";



GRANT ALL ON TABLE "public"."raw_alerts" TO "anon";
GRANT ALL ON TABLE "public"."raw_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."raw_alerts" TO "service_role";



GRANT ALL ON TABLE "public"."rotation_cycles" TO "anon";
GRANT ALL ON TABLE "public"."rotation_cycles" TO "authenticated";
GRANT ALL ON TABLE "public"."rotation_cycles" TO "service_role";



GRANT ALL ON TABLE "public"."schedulers" TO "anon";
GRANT ALL ON TABLE "public"."schedulers" TO "authenticated";
GRANT ALL ON TABLE "public"."schedulers" TO "service_role";



GRANT ALL ON TABLE "public"."schema_migrations" TO "anon";
GRANT ALL ON TABLE "public"."schema_migrations" TO "authenticated";
GRANT ALL ON TABLE "public"."schema_migrations" TO "service_role";



GRANT ALL ON TABLE "public"."service_checks" TO "anon";
GRANT ALL ON TABLE "public"."service_checks" TO "authenticated";
GRANT ALL ON TABLE "public"."service_checks" TO "service_role";



GRANT ALL ON TABLE "public"."service_incidents" TO "anon";
GRANT ALL ON TABLE "public"."service_incidents" TO "authenticated";
GRANT ALL ON TABLE "public"."service_incidents" TO "service_role";



GRANT ALL ON TABLE "public"."service_integrations" TO "anon";
GRANT ALL ON TABLE "public"."service_integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."service_integrations" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON TABLE "public"."uptime_stats" TO "anon";
GRANT ALL ON TABLE "public"."uptime_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."uptime_stats" TO "service_role";



GRANT ALL ON TABLE "public"."user_notification_configs" TO "anon";
GRANT ALL ON TABLE "public"."user_notification_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."user_notification_configs" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























RESET ALL;
