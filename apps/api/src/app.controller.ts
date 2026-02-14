import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get()
  health(): { status: "ok"; service: "api" } {
    return {
      status: "ok",
      service: "api",
    };
  }
}
