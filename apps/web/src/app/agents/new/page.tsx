import { redirect } from "next/navigation";

/**
 * Legacy route. The new-agent compose page has been replaced by an
 * in-place modal on the fleet list (`NewAgentModal`). Deep links and
 * bookmarks to /agents/new are redirected to /agents where the user
 * can hit "+ New agent" to open the modal.
 */
export default function NewAgentRedirect(): never {
  redirect("/agents");
}
