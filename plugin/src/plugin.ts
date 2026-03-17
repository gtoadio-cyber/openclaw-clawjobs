import { ClawJobsService, createHttpHandler } from "./service.js";

export default function register(api) {
  const service = new ClawJobsService(api);

  api.registerHttpRoute({
    path: "/plugins/clawjobs",
    auth: "plugin",
    match: "prefix",
    handler: createHttpHandler(service),
  });

  api.registerService({
    id: "clawjobs-client",
    start: async () => {
      await service.start();
      api.logger.info("clawjobs client started");
    },
    stop: async () => {
      await service.stop();
      api.logger.info("clawjobs client stopped");
    },
  });
}
