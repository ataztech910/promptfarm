import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PromptSchema } from "@promptfarm/core";
import { createInMemoryNodeExecutionRepository } from "@promptfarm/core";
import { createStudioAuthRepositoryForEnvironment } from "./studioAuthRepository.js";
import { createStudioAuthService } from "./studioAuthService.js";
import { createStudioExecutionService } from "./studioExecutionService.js";
import { createStudioPromptDocumentRepositoryForEnvironment } from "./studioPromptDocumentRepository.js";
import { createStudioPromptDocumentService } from "./studioPromptDocumentService.js";
import { createStudioProjectRepositoryForEnvironment } from "./studioProjectRepository.js";
import { createStudioProjectService } from "./studioProjectService.js";
import { createStudioPromptRuntimeRepositoryForEnvironment } from "./studioPromptRuntimeRepository.js";
import { createStudioPromptRuntimeService } from "./studioPromptRuntimeService.js";
import { createPromptFarmStudioServer } from "./studioServer.js";

test("studio server serves SPA and persisted runtime API from a single process", async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "promptfarm-studio-server-"));
  const studioDistDir = path.join(cwd, "studio-dist");
  await fs.mkdir(studioDistDir, { recursive: true });
  await fs.writeFile(path.join(studioDistDir, "index.html"), "<!doctype html><html><body>Studio</body></html>", "utf8");

  const runtimeRepository = createStudioPromptRuntimeRepositoryForEnvironment({
    cwd,
    env: {},
  });
  const runtimeService = createStudioPromptRuntimeService({
    repository: runtimeRepository,
  });
  const promptDocumentRepository = createStudioPromptDocumentRepositoryForEnvironment({
    cwd,
    env: {},
  });
  const projectRepository = createStudioProjectRepositoryForEnvironment({
    cwd,
    env: {},
  });
  const authRepository = createStudioAuthRepositoryForEnvironment({
    cwd,
    env: {},
  });
  const authService = createStudioAuthService({
    repository: authRepository,
  });
  const promptDocumentService = createStudioPromptDocumentService({
    repository: promptDocumentRepository,
  });
  const projectService = createStudioProjectService({
    repository: projectRepository,
    promptDocumentRepository,
  });
  const promptFarmServer = createPromptFarmStudioServer({
    host: "127.0.0.1",
    port: 0,
    studioDistDir,
    authService,
    projectService,
    promptDocumentService,
    runtimeService,
    executionService: createStudioExecutionService({
      executionRepository: createInMemoryNodeExecutionRepository(),
    }),
  });

  try {
    let address;
    try {
      address = await promptFarmServer.start();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        t.skip("Sandbox does not permit binding a local server socket.");
        return;
      }
      throw error;
    }
    const baseUrl = `http://${address.host}:${address.port}`;

    const signupResponse = await fetch(`${baseUrl}/api/studio/auth/setup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "owner@example.com",
        password: "Supersecret1",
      }),
    });
    assert.equal(signupResponse.status, 201);
    const sessionCookie = signupResponse.headers.get("set-cookie");
    assert.ok(sessionCookie);

    const sessionResponse = await fetch(`${baseUrl}/api/studio/auth/session`, {
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(sessionResponse.status, 200);
    const sessionPayload = (await sessionResponse.json()) as { user: { email: string } | null; setupRequired: boolean };
    assert.equal(sessionPayload.user?.email, "owner@example.com");
    assert.equal(sessionPayload.setupRequired, false);

    const promptFixture = PromptSchema.parse({
      apiVersion: "promptfarm/v1",
      kind: "Prompt",
      metadata: {
        id: "book",
        version: "1.0.0",
        title: "Book",
        tags: [],
      },
      spec: {
        artifact: {
          type: "book_text",
        },
        messages: [
          {
            role: "user",
            content: "Write a book.",
          },
        ],
        inputs: [],
        use: [],
        buildTargets: [],
        blocks: [],
      },
    });

    const createProjectResponse = await fetch(`${baseUrl}/api/studio/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie!,
      },
      body: JSON.stringify({
        name: "Demo Project",
        description: "Local demo",
      }),
    });
    assert.equal(createProjectResponse.status, 201);
    const createdProject = (await createProjectResponse.json()) as { id: string; name: string; promptCount: number; canDelete: boolean };
    assert.equal(createdProject.name, "Demo Project");
    assert.equal(createdProject.promptCount, 0);
    assert.equal(createdProject.canDelete, true);

    const listProjectsResponse = await fetch(`${baseUrl}/api/studio/projects`, {
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(listProjectsResponse.status, 200);
    const projectsPayload = (await listProjectsResponse.json()) as {
      projects: Array<{ id: string; name: string; promptCount: number; canDelete: boolean }>;
    };
    assert.equal(projectsPayload.projects[0]?.id, createdProject.id);
    assert.equal(projectsPayload.projects[0]?.promptCount, 0);

    const getProjectResponse = await fetch(`${baseUrl}/api/studio/projects/${createdProject.id}`, {
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(getProjectResponse.status, 200);
    const projectPayload = (await getProjectResponse.json()) as { id: string; name: string; promptCount: number; canDelete: boolean };
    assert.equal(projectPayload.id, createdProject.id);
    assert.equal(projectPayload.promptCount, 0);

    const putPromptResponse = await fetch(`${baseUrl}/api/studio/prompts/book`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie!,
      },
      body: JSON.stringify({
        prompt: promptFixture,
        projectId: createdProject.id,
      }),
    });
    assert.equal(putPromptResponse.status, 200);

    const putPromptPayload = (await putPromptResponse.json()) as {
      prompt: { metadata: { id: string } };
      summary: { projectId: string | null; projectName: string | null };
    };
    assert.equal(putPromptPayload.prompt.metadata.id, "book");
    assert.equal(putPromptPayload.summary.projectId, createdProject.id);
    assert.equal(putPromptPayload.summary.projectName, "Demo Project");

    const getPromptResponse = await fetch(`${baseUrl}/api/studio/prompts/book`, {
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(getPromptResponse.status, 200);
    const promptPayload = (await getPromptResponse.json()) as {
      prompt: { metadata: { id: string; title: string } };
      summary: { promptId: string; projectId: string | null; projectName: string | null };
    };
    assert.equal(promptPayload.prompt.metadata.id, "book");
    assert.equal(promptPayload.prompt.metadata.title, "Book");
    assert.equal(promptPayload.summary.projectId, createdProject.id);
    assert.equal(promptPayload.summary.projectName, "Demo Project");

    const listPromptResponse = await fetch(`${baseUrl}/api/studio/prompts`, {
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(listPromptResponse.status, 200);
    const promptIndexPayload = (await listPromptResponse.json()) as {
      prompts: Array<{ promptId: string; projectId: string | null; projectName: string | null; title: string; artifactType: string }>;
    };
    assert.equal(promptIndexPayload.prompts[0]?.promptId, "book");
    assert.equal(promptIndexPayload.prompts[0]?.projectId, createdProject.id);
    assert.equal(promptIndexPayload.prompts[0]?.projectName, "Demo Project");
    assert.equal(promptIndexPayload.prompts[0]?.artifactType, "book_text");

    const filteredPromptResponse = await fetch(`${baseUrl}/api/studio/prompts?projectId=${encodeURIComponent(createdProject.id)}`, {
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(filteredPromptResponse.status, 200);
    const filteredPromptPayload = (await filteredPromptResponse.json()) as {
      prompts: Array<{ promptId: string; projectId: string | null }>;
    };
    assert.equal(filteredPromptPayload.prompts.length, 1);
    assert.equal(filteredPromptPayload.prompts[0]?.projectId, createdProject.id);

    const createSecondProjectResponse = await fetch(`${baseUrl}/api/studio/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie!,
      },
      body: JSON.stringify({
        name: "Second Project",
      }),
    });
    assert.equal(createSecondProjectResponse.status, 201);
    const secondProject = (await createSecondProjectResponse.json()) as { id: string; name: string };

    const movePromptResponse = await fetch(`${baseUrl}/api/studio/prompts/book/project`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie!,
      },
      body: JSON.stringify({
        projectId: secondProject.id,
      }),
    });
    assert.equal(movePromptResponse.status, 200);
    const movedPromptPayload = (await movePromptResponse.json()) as {
      summary: { projectId: string | null; projectName: string | null };
    };
    assert.equal(movedPromptPayload.summary.projectId, secondProject.id);
    assert.equal(movedPromptPayload.summary.projectName, "Second Project");

    const movedFilteredPromptResponse = await fetch(`${baseUrl}/api/studio/prompts?projectId=${encodeURIComponent(secondProject.id)}`, {
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(movedFilteredPromptResponse.status, 200);
    const movedFilteredPromptPayload = (await movedFilteredPromptResponse.json()) as {
      prompts: Array<{ promptId: string; projectId: string | null }>;
    };
    assert.equal(movedFilteredPromptPayload.prompts.length, 1);
    assert.equal(movedFilteredPromptPayload.prompts[0]?.projectId, secondProject.id);

    const refreshedFirstProjectResponse = await fetch(`${baseUrl}/api/studio/projects/${createdProject.id}`, {
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(refreshedFirstProjectResponse.status, 200);
    const refreshedFirstProjectPayload = (await refreshedFirstProjectResponse.json()) as {
      promptCount: number;
      canDelete: boolean;
    };
    assert.equal(refreshedFirstProjectPayload.promptCount, 0);
    assert.equal(refreshedFirstProjectPayload.canDelete, true);

    const deleteNonEmptyProjectResponse = await fetch(`${baseUrl}/api/studio/projects/${createdProject.id}`, {
      method: "DELETE",
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(deleteNonEmptyProjectResponse.status, 204);

    const deleteStillNonEmptySecondProjectResponse = await fetch(`${baseUrl}/api/studio/projects/${secondProject.id}`, {
      method: "DELETE",
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(deleteStillNonEmptySecondProjectResponse.status, 409);

    const putResponse = await fetch(`${baseUrl}/api/studio/persistence/prompts/book/runtime`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie!,
      },
      body: JSON.stringify({
        version: 1,
        promptId: "book",
        latestScopeOutputs: {
          root: { kind: "generated_output", text: "Hello" },
        },
      }),
    });
    assert.equal(putResponse.status, 200);

    const getResponse = await fetch(`${baseUrl}/api/studio/persistence/prompts/book/runtime`, {
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(getResponse.status, 200);
    const payload = (await getResponse.json()) as { promptId: string; latestScopeOutputs: Record<string, unknown> };
    assert.equal(payload.promptId, "book");
    assert.deepEqual(payload.latestScopeOutputs, {
      root: { kind: "generated_output", text: "Hello" },
    });

    const putGraphProposalsResponse = await fetch(`${baseUrl}/api/studio/persistence/prompts/book/graph-proposals`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie!,
      },
      body: JSON.stringify({
        graph_proposal_1: {
          status: "preview",
        },
      }),
    });
    assert.equal(putGraphProposalsResponse.status, 200);

    const getGraphProposalsResponse = await fetch(`${baseUrl}/api/studio/persistence/prompts/book/graph-proposals`, {
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(getGraphProposalsResponse.status, 200);
    assert.deepEqual(await getGraphProposalsResponse.json(), {
      graph_proposal_1: {
        status: "preview",
      },
    });

    const putRuntimeSnapshotResponse = await fetch(`${baseUrl}/api/studio/persistence/prompts/book/runtime-snapshot`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie!,
      },
      body: JSON.stringify({
        latestScopeOutputs: {
          root: { kind: "generated_output", text: "Updated" },
        },
        nodeRuntimeStates: {
          prompt_root_book: { status: "success" },
        },
        nodeExecutionRecords: {
          node_exec_1: { status: "success" },
        },
      }),
    });
    assert.equal(putRuntimeSnapshotResponse.status, 200);

    const getRuntimeSnapshotResponse = await fetch(`${baseUrl}/api/studio/persistence/prompts/book/runtime-snapshot`, {
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(getRuntimeSnapshotResponse.status, 200);
    assert.deepEqual(await getRuntimeSnapshotResponse.json(), {
      latestScopeOutputs: {
        root: { kind: "generated_output", text: "Updated" },
      },
      nodeRuntimeStates: {
        prompt_root_book: { status: "success" },
      },
      nodeExecutionRecords: {
        node_exec_1: { status: "success" },
      },
    });

    const deleteResponse = await fetch(`${baseUrl}/api/studio/persistence/prompts/book/runtime`, {
      method: "DELETE",
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(deleteResponse.status, 204);

    const missingAfterDelete = await fetch(`${baseUrl}/api/studio/persistence/prompts/book/runtime`, {
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(missingAfterDelete.status, 404);

    const deletePromptResponse = await fetch(`${baseUrl}/api/studio/prompts/book`, {
      method: "DELETE",
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(deletePromptResponse.status, 204);

    const missingPromptAfterDelete = await fetch(`${baseUrl}/api/studio/prompts/book`, {
      headers: {
        Cookie: sessionCookie!,
      },
    });
    assert.equal(missingPromptAfterDelete.status, 404);

    const spaResponse = await fetch(`${baseUrl}/nested/editor/route`);
    assert.equal(spaResponse.status, 200);
    assert.match(await spaResponse.text(), /Studio/);
  } finally {
    await promptFarmServer.close();
    await authRepository.close?.();
    await projectRepository.close?.();
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
