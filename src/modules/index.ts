import { registerModule } from "../core/registry";
import { businessModules } from "./business";
import { cameraModule } from "./camera";
import { climateModule } from "./climate";
import { feedsModule } from "./feeds";
import { fmModule } from "./fm";
import { homeModule } from "./home";
import { hostModule } from "./host";
import { labModule } from "./lab";
import { labNodeModule } from "./labnode";
import { localModule } from "./local";
import { marketsModules } from "./markets";
import { mediaModule } from "./media";
import { netIoModule } from "./netio";
import { nodesModule } from "./nodes";
import { placeholderModule } from "./placeholder";
import { servicesModule } from "./services";
import { threatModule } from "./threat";
import { weatherModule } from "./weather";

/** Built-in modules. A module is registered once and can appear in any number of layout panels. */
export function registerBuiltins(): void {
  for (const module of [hostModule, servicesModule, cameraModule, threatModule, fmModule, nodesModule, feedsModule, labModule, mediaModule, placeholderModule,
    homeModule, weatherModule, climateModule, labNodeModule, netIoModule, localModule, ...businessModules, ...marketsModules]) registerModule(module);
}
