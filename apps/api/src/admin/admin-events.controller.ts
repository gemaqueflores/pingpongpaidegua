import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { AdminEventsService } from "./admin-events.service";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RolesGuard } from "../common/roles.guard";
import { Roles } from "../common/roles.decorator";
import { CreateAdminEventDto } from "./dto/create-admin-event.dto";
import { UpdateAdminEventDto } from "./dto/update-admin-event.dto";
import { ResolveAthleteConflictDto } from "./dto/resolve-athlete-conflict.dto";
import { RawCaptureCleanupDto } from "./dto/raw-capture-cleanup.dto";
import { ScrapeNowDto } from "./dto/scrape-now.dto";
import { UpdateEfficiencyConfigDto } from "./dto/update-efficiency-config.dto";

@Controller("admin/events")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AdminEventsController {
  constructor(private readonly service: AdminEventsService) {}

  @Get()
  async listEvents() {
    return this.service.listEvents();
  }

  @Get("efficiency-config")
  async getEfficiencyConfig() {
    return this.service.getEfficiencyConfig();
  }

  @Put("efficiency-config")
  async updateEfficiencyConfig(@Body() body: UpdateEfficiencyConfigDto) {
    return this.service.updateEfficiencyConfig(body);
  }

  @Post()
  async createEvent(@Body() body: CreateAdminEventDto) {
    return this.service.createEvent(body);
  }

  @Put(":id")
  async updateEvent(@Param("id", ParseIntPipe) id: number, @Body() body: UpdateAdminEventDto) {
    return this.service.updateEvent(id, body);
  }

  @Delete(":id")
  async deleteEvent(@Param("id", ParseIntPipe) id: number) {
    return this.service.deleteEvent(id);
  }

  @Post(":id/mark-completed")
  async markCompleted(@Param("id", ParseIntPipe) id: number) {
    return this.service.markCompleted(id);
  }

  @Post(":id/scrape-now")
  async scrapeNow(@Param("id", ParseIntPipe) id: number, @Body() body: ScrapeNowDto) {
    return this.service.scrapeNow(id, body.stage);
  }

  @Get(":id/scrape-runs")
  async listScrapeRuns(@Param("id", ParseIntPipe) id: number) {
    return this.service.listScrapeRuns(id);
  }

  @Post("raw-captures/cleanup")
  async cleanupRawCapturesGlobal(@Body() body: RawCaptureCleanupDto) {
    return this.service.cleanupRawCaptures({
      eventId: body.eventId,
      dryRun: body.dryRun ?? false,
    });
  }

  @Post(":id/raw-captures/cleanup")
  async cleanupRawCapturesByEvent(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: RawCaptureCleanupDto,
  ) {
    return this.service.cleanupRawCaptures({
      eventId: id,
      dryRun: body.dryRun ?? false,
    });
  }

  @Get(":id/athlete-conflicts")
  async listAthleteConflicts(@Param("id", ParseIntPipe) id: number) {
    return this.service.listAthleteConflicts(id);
  }

  @Post(":id/athlete-conflicts/:conflictId/resolve")
  async resolveAthleteConflict(
    @Param("id", ParseIntPipe) id: number,
    @Param("conflictId", ParseIntPipe) conflictId: number,
    @Body() body: ResolveAthleteConflictDto,
  ) {
    return this.service.resolveAthleteConflict(id, conflictId, body.athleteId);
  }
}
