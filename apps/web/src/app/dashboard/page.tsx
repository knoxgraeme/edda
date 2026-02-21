/**
 * Dashboard page — daily overview
 *
 * Custom Edda page (not from deep-agents-ui).
 * Shows: due today, captured today, open items, lists, pending confirmations.
 */

export default function DashboardPage() {
  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      {/* TODO: Implement dashboard view using getDashboard() from @edda/db */}
      <p className="text-gray-400">Daily overview — scaffold ready.</p>
    </main>
  );
}
