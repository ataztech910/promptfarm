import path from "node:path";
import readline from "node:readline/promises";
import { Command } from "commander";
import { createStudioAuthRepositoryForEnvironment, type StudioAuthRepositoryProvider } from "../server/studioAuthRepository.js";

async function confirmResetOwner(): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("This will remove the local owner account and all local Studio sessions. Continue? [y/N] "))
      .trim()
      .toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export function cmdAuthResetOwner(): Command {
  return new Command("auth:reset-owner")
    .description("Reset the local Studio owner account and force first-run setup on next login")
    .option("--cwd <path>", "Project root", process.cwd())
    .option("--data-dir <path>", "Directory for server-side PromptFarm data", path.resolve(process.cwd(), ".promptfarm"))
    .option("--store-provider <provider>", "Studio auth store provider (sqlite, file_json, postgres)")
    .option("-y, --yes", "Skip confirmation")
    .action(async (opts) => {
      const yes = Boolean(opts.yes);
      if (!yes) {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
          console.error("❌ auth:reset-owner requires confirmation. Re-run with --yes to confirm non-interactively.");
          process.exitCode = 1;
          return;
        }
        const confirmed = await confirmResetOwner();
        if (!confirmed) {
          console.log("auth reset aborted");
          return;
        }
      }

      const repository = createStudioAuthRepositoryForEnvironment({
        cwd: path.resolve(opts.cwd),
        dataDir: opts.dataDir,
        ...(opts.storeProvider ? { provider: opts.storeProvider as StudioAuthRepositoryProvider } : {}),
      });

      try {
        await repository.clearAllAuthData();
        console.log(`reset local Studio owner auth data in ${path.resolve(opts.dataDir)}`);
      } finally {
        await repository.close?.();
      }
    });
}
