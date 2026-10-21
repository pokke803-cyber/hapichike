import { requireSupabase, unwrap } from "./apiClient.js";

export const getTasks = (householdId) => unwrap(requireSupabase().from("tasks").select("*").eq("household_id", householdId).eq("is_active", true));
export const createTask = (task) => unwrap(requireSupabase().from("tasks").insert(task).select().single());
export const updateTask = (taskId, patch) => unwrap(requireSupabase().from("tasks").update(patch).eq("id", taskId).select().single());
export const archiveTask = (taskId) => updateTask(taskId, { is_active: false });

export const getTodayTasks = (childId) => unwrap(
  requireSupabase()
    .from("today_tasks")
    .select("*, tasks(*)")
    .eq("child_id", childId)
    .order("created_at"),
);

export const createTodayTask = (todayTask) => unwrap(
  requireSupabase().from("today_tasks").insert(todayTask).select("*, tasks(*)").single(),
);

export const updateTodayTask = (todayTaskId, patch) => unwrap(
  requireSupabase().from("today_tasks").update(patch).eq("id", todayTaskId).select("*, tasks(*)").single(),
);

export const completeTodayTask = (todayTaskId) => unwrap(
  requireSupabase().rpc("complete_today_task", { today_task_id_arg: todayTaskId }),
);
