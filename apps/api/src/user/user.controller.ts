import { Body, Controller, Get, Header, Inject, Param, ParseIntPipe, Post, Query, UseInterceptors } from "@nestjs/common";
import { UserService } from "./user.service";
import { AthleteSummaryQueryDto } from "./dto/athlete-summary-query.dto";
import { ReportProblemDto } from "./dto/report-problem.dto";
import { PublicReadCacheInterceptor } from "../common/public-read-cache.interceptor";
import { PublicCacheTtl } from "../common/public-cache.decorator";

@Controller()
@UseInterceptors(PublicReadCacheInterceptor)
export class UserController {
  private readonly service: UserService;

  constructor(@Inject(UserService) service: UserService) {
    this.service = service;
  }

  @Get("events")
  @PublicCacheTtl(90)
  async listEvents() {
    return this.service.listEvents();
  }

  @Get("events/:id")
  @PublicCacheTtl(90)
  async getEventSummary(@Param("id", ParseIntPipe) eventId: number) {
    return this.service.getEventSummary(eventId);
  }

  @Get("events/:id/athletes")
  @PublicCacheTtl(45)
  async listAthletes(
    @Param("id", ParseIntPipe) eventId: number,
    @Query("search") search?: string,
  ) {
    return this.service.listAthletes(eventId, search ?? "");
  }

  @Get("events/:id/clubs")
  async listClubs(
    @Param("id", ParseIntPipe) eventId: number,
    @Query("search") search?: string,
    @Query("categoryId") categoryId?: string,
  ) {
    const parsedCategoryId = categoryId ? Number(categoryId) : null;
    return this.service.listClubs(
      eventId,
      search ?? "",
      parsedCategoryId && Number.isFinite(parsedCategoryId) ? parsedCategoryId : null,
    );
  }

  @Get("events/:id/categories")
  async listCategories(@Param("id", ParseIntPipe) eventId: number) {
    return this.service.listCategories(eventId);
  }

  @Get("events/:id/efficiency")
  async listEventEfficiency(@Param("id", ParseIntPipe) eventId: number) {
    return this.service.listEventEfficiency(eventId);
  }

  @Get("efficiency")
  async listGlobalEfficiency() {
    return this.service.listGlobalEfficiency();
  }

  @Get("events/:id/group-simulation")
  async groupSimulation(
    @Param("id", ParseIntPipe) eventId: number,
    @Query("categoryId") categoryId?: string,
    @Query("registrationScope") registrationScope?: string,
    @Query("debug") debug?: string,
  ) {
    const parsedCategoryId = categoryId ? Number(categoryId) : null;
    const debugMode = debug === "1" || String(debug ?? "").toLowerCase() === "true";
    return this.service.simulateGroups(
      eventId,
      parsedCategoryId && Number.isFinite(parsedCategoryId) ? parsedCategoryId : null,
      registrationScope ?? null,
      debugMode,
    );
  }

  @Get("events/:id/clubs/:clubId/athletes")
  async listClubAthletes(
    @Param("id", ParseIntPipe) eventId: number,
    @Param("clubId", ParseIntPipe) clubId: number,
    @Query("categoryId") categoryId?: string,
  ) {
    const parsedCategoryId = categoryId ? Number(categoryId) : null;
    return this.service.listClubAthletes(
      eventId,
      clubId,
      parsedCategoryId && Number.isFinite(parsedCategoryId) ? parsedCategoryId : null,
    );
  }

  @Get("events/:id/athletes/:athleteId/summary")
  @PublicCacheTtl(60)
  async athleteSummary(
    @Param("id", ParseIntPipe) eventId: number,
    @Param("athleteId", ParseIntPipe) athleteId: number,
    @Query() query: AthleteSummaryQueryDto,
  ) {
    return this.service.getAthleteSummary(eventId, athleteId, query.orderBy ?? "phase_hierarchy_datetime");
  }

  @Get("events/:id/athletes/:athleteId/identity")
  @Header("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400")
  async athleteIdentity(
    @Param("id", ParseIntPipe) eventId: number,
    @Param("athleteId", ParseIntPipe) athleteId: number,
  ) {
    return this.service.getAthleteIdentity(eventId, athleteId);
  }

  @Get("athletes/directory")
  async athletesDirectory(@Query("search") search?: string) {
    return this.service.listAthleteDirectory(search ?? "");
  }

  @Get("athletes/:athleteKey/career")
  async athleteCareer(@Param("athleteKey") athleteKey: string) {
    return this.service.getAthleteCareer(athleteKey);
  }

  @Get("clubs/:clubId/efficiency-career")
  async clubEfficiencyCareer(@Param("clubId", ParseIntPipe) clubId: number) {
    return this.service.getClubEfficiencyCareer(clubId);
  }

  @Post("support/report-problem")
  async reportProblem(@Body() body: ReportProblemDto) {
    return this.service.reportProblem(body.title, body.description);
  }
}
