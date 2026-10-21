import { requireSupabase, unwrap } from "./apiClient.js";

export const getHelpJobs = (householdId) => unwrap(requireSupabase().from("help_jobs").select("*, help_job_applicants(*)").eq("household_id", householdId));
export const createHelpJob = (job) => unwrap(requireSupabase().from("help_jobs").insert(job).select().single());
export const applyToHelpJob = (application) => unwrap(requireSupabase().from("help_job_applicants").insert(application).select().single());
export const markHelpJobDone = (applicantId) => unwrap(requireSupabase().from("help_job_applicants").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", applicantId).select().single());
export const approveHelpJobReward = (applicantId) => unwrap(
  requireSupabase().rpc("approve_help_job_reward", { applicant_id_arg: applicantId }),
);
