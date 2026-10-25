import { registerModule } from "../core/registry";
import { feedsModule } from "./feeds";
import { labModule } from "./lab";
import { mediaModule } from "./media";
import { nodesModule } from "./nodes";
import { placeholderModule } from "./placeholder";

/** Built-in modules. A module is registered once and can appear in any number of layout panels. */
export function registerBuiltins(): void {
  for (const module of [nodesModule, feedsModule, labModule, mediaModule, placeholderModule]) registerModule(module);
}
