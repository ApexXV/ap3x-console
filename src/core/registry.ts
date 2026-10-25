import type { AnyModule } from "./types";

const ID = /^[a-z][a-z0-9-]{1,40}$/;
const modules = new Map<string, AnyModule>();

export function registerModule(module: AnyModule): void {
  if (!ID.test(module.id)) throw new Error(`module id "${module.id}" must be lowercase letters, digits, or dashes`);
  if (modules.has(module.id)) throw new Error(`module "${module.id}" is registered twice`);
  for (const source of module.sources) {
    if (!ID.test(source.id)) throw new Error(`module "${module.id}": source id "${source.id}" is not valid`);
  }
  modules.set(module.id, module);
}

export function getModule(id: string): AnyModule | undefined {
  return modules.get(id);
}

export function moduleIds(): string[] {
  return [...modules.keys()].sort();
}
