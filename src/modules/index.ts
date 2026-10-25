import { registerModule } from "../core/registry";
import { cameraModule } from "./camera";
import { feedsModule } from "./feeds";
import { fmModule } from "./fm";
import { hostModule } from "./host";
import { labModule } from "./lab";
import { mediaModule } from "./media";
import { nodesModule } from "./nodes";
import { placeholderModule } from "./placeholder";
import { servicesModule } from "./services";
import { threatModule } from "./threat";

/** Built-in modules. A module is registered once and can appear in any number of layout panels. */
export function registerBuiltins(): void {
  for (const module of [hostModule, servicesModule, cameraModule, threatModule, fmModule, nodesModule, feedsModule, labModule, mediaModule, placeholderModule]) registerModule(module);
}
