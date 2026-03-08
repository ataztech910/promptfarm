#!/usr/bin/env node
import { Command } from "commander";
import { cmdBuild } from "./commands/build.js";
import { cmdList } from "./commands/list.js";
import { cmdRender } from "./commands/render.js";
import { cmdValidate } from "./commands/validate.js";
import { cmdSearch } from "./commands/search.js";
import { cmdInfo } from "./commands/info.js";
import { cmdPaths } from "./commands/paths.js";
import { cmdDiscover } from "./commands/discover.js";
import { cmdInit } from "./commands/init.js";
import { cmdContext } from "./commands/context.js";
import { cmdReset } from "./commands/reset.js";
import { cmdTest } from "./commands/test.js";
import { cmdDoctor } from "./commands/doctor.js";


const program = new Command();

program
  .name("promptfarm")
  .description("Prompt infrastructure CLI: init, validate, test, build, list, render, discover, context, reset")
  .version("0.1.0");

program.addCommand(cmdInit());
program.addCommand(cmdDiscover());
program.addCommand(cmdValidate());
program.addCommand(cmdTest());
program.addCommand(cmdBuild());
program.addCommand(cmdList());
program.addCommand(cmdRender());
program.addCommand(cmdSearch());
program.addCommand(cmdInfo());
program.addCommand(cmdPaths());
program.addCommand(cmdContext());
program.addCommand(cmdReset());
program.addCommand(cmdDoctor());

program.parse(process.argv);
