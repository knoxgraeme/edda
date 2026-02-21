/**
 * Settings page — configurable via settings table
 *
 * Server component fetches current settings.
 * Client component renders the form with save action.
 */

import { getSettings } from "@edda/db";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  let settings;
  try {
    settings = await getSettings();
  } catch (err) {
    console.error("Failed to load settings:", err);
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        <p className="text-muted-foreground">
          Unable to load settings. Make sure the database is running and
          migrations have been applied.
        </p>
      </main>
    );
  }

  return <SettingsClient initial={settings} />;
}
