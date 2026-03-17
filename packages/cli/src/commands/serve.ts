import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { createNodeExecutionRepositoryForEnvironment } from "@promptfarm/core/node";
import { createStudioAuthRepositoryForEnvironment } from "../server/studioAuthRepository.js";
import { createStudioAuthService } from "../server/studioAuthService.js";
import { createStudioProjectRepositoryForEnvironment } from "../server/studioProjectRepository.js";
import { createStudioProjectService } from "../server/studioProjectService.js";
import { createPromptFarmStudioServer } from "../server/studioServer.js";
import { createStudioPromptDocumentRepositoryForEnvironment } from "../server/studioPromptDocumentRepository.js";
import { createStudioPromptDocumentService } from "../server/studioPromptDocumentService.js";
import { createStudioExecutionService } from "../server/studioExecutionService.js";
import { createStudioPromptRuntimeService } from "../server/studioPromptRuntimeService.js";
import {
  createStudioPromptRuntimeRepositoryForEnvironment,
  type StudioPromptRuntimeRepositoryProvider,
} from "../server/studioPromptRuntimeRepository.js";

async function resolveStudioDistDir(input?: string): Promise<string | null> {
  if (input?.trim() === "") {
    return null;
  }

  const candidatePaths = input
    ? [path.resolve(input)]
    : [
        path.resolve(process.cwd(), "apps/studio/dist"),
        path.resolve(process.cwd(), "../apps/studio/dist"),
        path.resolve(process.cwd(), "../../apps/studio/dist"),
      ];

  for (const candidate of candidatePaths) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return input ? path.resolve(input) : null;
}

export function cmdServe(): Command {
  const command = new Command("serve")
    .description("Serve PromptFarm Studio and persistence API from a single Node process")
    .option("--host <host>", "Host interface to bind", "127.0.0.1")
    .option("--port <port>", "Port to listen on", "4310")
    .option("--studio-dist <path>", "Path to built Studio assets")
    .option("--data-dir <path>", "Directory for server-side PromptFarm data", path.resolve(process.cwd(), ".promptfarm"))
    .option("--store-provider <provider>", "Studio runtime store provider (sqlite, file_json, postgres)")
    .action(async (opts) => {
      const port = Number.parseInt(String(opts.port), 10);
      if (!Number.isFinite(port) || port <= 0) {
        throw new Error(`Invalid --port value: ${opts.port}`);
      }

      const studioDistDir = await resolveStudioDistDir(opts.studioDist);
      const runtimeRepository = createStudioPromptRuntimeRepositoryForEnvironment({
        cwd: process.cwd(),
        dataDir: opts.dataDir,
        ...(opts.storeProvider ? { provider: opts.storeProvider as StudioPromptRuntimeRepositoryProvider } : {}),
      });
      const promptDocumentRepository = createStudioPromptDocumentRepositoryForEnvironment({
        cwd: process.cwd(),
        dataDir: opts.dataDir,
        ...(opts.storeProvider ? { provider: opts.storeProvider as StudioPromptRuntimeRepositoryProvider } : {}),
      });
      const promptDocumentService = createStudioPromptDocumentService({
        repository: promptDocumentRepository,
      });
      const authRepository = createStudioAuthRepositoryForEnvironment({
        cwd: process.cwd(),
        dataDir: opts.dataDir,
        ...(opts.storeProvider ? { provider: opts.storeProvider as StudioPromptRuntimeRepositoryProvider } : {}),
      });
      const authService = createStudioAuthService({
        repository: authRepository,
      });
      const projectRepository = createStudioProjectRepositoryForEnvironment({
        cwd: process.cwd(),
        dataDir: opts.dataDir,
        ...(opts.storeProvider ? { provider: opts.storeProvider as StudioPromptRuntimeRepositoryProvider } : {}),
      });
      const projectService = createStudioProjectService({
        repository: projectRepository,
        promptDocumentRepository,
      });
      const runtimeService = createStudioPromptRuntimeService({
        repository: runtimeRepository,
      });
      const executionRepository = createNodeExecutionRepositoryForEnvironment({
        cwd: process.cwd(),
        defaultSqliteFilename: path.join(opts.dataDir, "promptfarm.db"),
      });
      const executionService = createStudioExecutionService({
        executionRepository,
      });

      const promptFarmServer = createPromptFarmStudioServer({
        host: String(opts.host),
        port,
        studioDistDir,
        authService,
        projectService,
        promptDocumentService,
        runtimeService,
        executionService,
      });

      const address = await promptFarmServer.start();
      const hostLabel = address.host === "::" ? "127.0.0.1" : address.host;
      console.log(`PromptFarm Studio server listening at http://${hostLabel}:${address.port}`);
      console.log(`Prompt document API: http://${hostLabel}:${address.port}/api/studio/prompts/:promptId`);
      console.log(`Auth API: http://${hostLabel}:${address.port}/api/studio/auth/session`);
      console.log(`Projects API: http://${hostLabel}:${address.port}/api/studio/projects`);
      console.log(`Persistence API: http://${hostLabel}:${address.port}/api/studio/persistence/prompts/:promptId/runtime`);
      console.log(`Execution API: http://${hostLabel}:${address.port}/api/studio/executions`);
      console.log(`Runtime repository provider: ${runtimeService.provider}`);
      if (studioDistDir) {
        console.log(`Serving Studio static assets from ${studioDistDir}`);
      } else {
        console.warn("Studio static assets are disabled because no build directory was found.");
      }

      const shutdown = async (signal: string) => {
        console.log(`Received ${signal}. Shutting down PromptFarm Studio server...`);
        await promptFarmServer.close();
        process.exit(0);
      };

      process.once("SIGINT", () => {
        void shutdown("SIGINT");
      });
      process.once("SIGTERM", () => {
        void shutdown("SIGTERM");
      });
    });

  return command;
}
