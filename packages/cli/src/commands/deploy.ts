/**
 * `edda deploy [target]` — Deployment helpers
 *
 * Supported targets:
 *   fly    — Deploy to Fly.io
 *   render — Deploy to Render
 *
 * Each target checks for its CLI tool, validates config, and runs the deploy.
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { execa } from "execa";

export async function deploy(target?: string) {
  if (!target) {
    const choice = await p.select({
      message: "Where do you want to deploy?",
      options: [
        { value: "fly", label: "Fly.io" },
        { value: "render", label: "Render" },
      ],
    });

    if (p.isCancel(choice)) {
      p.cancel("Deploy cancelled");
      return;
    }

    target = choice as string;
  }

  switch (target) {
    case "fly":
      await deployFly();
      break;
    case "render":
      await deployRender();
      break;
    default:
      p.log.error(`Unknown deploy target: ${target}`);
      p.log.info("Supported targets: fly, render");
  }
}

async function deployFly() {
  p.intro(chalk.bold("Deploying to Fly.io"));

  // Check flyctl is installed
  try {
    await execa("flyctl", ["version"]);
  } catch {
    p.log.error("flyctl not found. Install it: https://fly.io/docs/flyctl/install/");
    return;
  }

  const s = p.spinner();

  // Check if app already exists
  s.start("Checking Fly.io app status...");
  try {
    await execa("flyctl", ["status", "--json"]);
    s.stop("App found");
  } catch {
    s.stop("No app found — will create one");

    const appName = await p.text({
      message: "Fly.io app name",
      placeholder: "edda-assistant",
    });

    if (p.isCancel(appName)) return;

    s.start("Creating Fly.io app...");
    await execa("flyctl", ["launch", "--name", appName as string, "--no-deploy", "--copy-config"]);
    s.stop("App created");
  }

  // Set secrets from .env
  p.log.info("Set secrets with: flyctl secrets import < .env");

  // Deploy
  const proceed = await p.confirm({
    message: "Deploy now?",
    initialValue: true,
  });

  if (!p.isCancel(proceed) && proceed) {
    s.start("Deploying...");
    try {
      await execa("flyctl", ["deploy"], { stdio: "inherit" });
      s.stop("Deployed!");
    } catch (err) {
      s.stop("Deploy failed");
      p.log.error(String(err));
    }
  }

  p.outro(chalk.green("Done"));
}

async function deployRender() {
  p.intro(chalk.bold("Deploying to Render"));
  p.log.info(
    "Render deploys via Git push using render.yaml.\n" +
      "  1. Push your repo to GitHub\n" +
      "  2. Connect the repo in the Render dashboard\n" +
      "  3. Render will auto-detect render.yaml and create services\n\n" +
      `  ${chalk.dim("Docs:")} https://render.com/docs/infrastructure-as-code`,
  );
  p.outro("No CLI action needed — deploy via Render dashboard");
}
