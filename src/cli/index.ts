#!/usr/bin/env node
import { Command } from "commander";
import { cmdBuild } from "./commands/build.js";
import { cmdList } from "./commands/list.js";
import { cmdRender } from "./commands/render.js";
import { cmdValidate } from "./commands/validate.js";
import { cmdSearch } from "./commands/search.js";
import { cmdInfo } from "./commands/info.js";
import { cmdPaths } from "./commands/paths.js";


const program = new Command();

program
  .name("promptfarm")
  .description("Prompt infrastructure CLI: validate, build, list, render")
  .version("0.1.0");

program.addCommand(cmdValidate());
program.addCommand(cmdBuild());
program.addCommand(cmdList());
program.addCommand(cmdRender());
program.addCommand(cmdSearch());
program.addCommand(cmdInfo());
program.addCommand(cmdPaths());

program.parse(process.argv);
