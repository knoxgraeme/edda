import { getSkills, getAgents } from "@edda/db";
import { SkillsClient } from "./skills-client";

export default async function SkillsPage() {
  const [skills, agents] = await Promise.all([getSkills(), getAgents()]);

  // Build a map of skill name → agent names that use it
  const skillAgentMap: Record<string, string[]> = {};
  for (const agent of agents) {
    for (const skillName of agent.skills) {
      if (!skillAgentMap[skillName]) skillAgentMap[skillName] = [];
      skillAgentMap[skillName].push(agent.name);
    }
  }

  return <SkillsClient skills={skills} skillAgentMap={skillAgentMap} />;
}
