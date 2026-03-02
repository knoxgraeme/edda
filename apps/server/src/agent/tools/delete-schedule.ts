/**
 * Tool: delete_schedule — Delete an agent schedule.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { deleteSchedule } from "@edda/db";

export const deleteScheduleSchema = z.object({
  schedule_id: z.string().uuid().describe("ID of the schedule to delete"),
});

export const deleteScheduleTool = tool(
  async ({ schedule_id }) => {
    await deleteSchedule(schedule_id);
    return JSON.stringify({ deleted: true, schedule_id });
  },
  {
    name: "delete_schedule",
    description: "Permanently delete an agent schedule.",
    schema: deleteScheduleSchema,
  },
);
