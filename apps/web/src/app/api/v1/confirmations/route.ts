import { getPendingItems } from "@edda/db";
import { jsonList } from "../_lib/helpers";

export async function GET() {
  const pending = await getPendingItems();
  return jsonList(pending);
}
