import { BadRequestException, Body, Controller, Get, Header, Inject, Param, ParseIntPipe, Post, Query, UseInterceptors } from "@nestjs/common";
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
  @PublicCacheTtl(20)
  async getEventSummary(@Param("id", ParseIntPipe) eventId: number) {
    return this.service.getEventSummary(eventId);
  }

  @Get("events/:id/athletes")
  @PublicCacheTtl(45)
  async listAthletes(
    @Param("id", ParseIntPipe) eventId: number,
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.service.listAthletes(eventId, search ?? "", page, pageSize);
  }

  @Get("events/:id/clubs")
  async listClubs(
    @Param("id", ParseIntPipe) eventId: number,
    @Query("search") search?: string,
    @Query("categoryId") categoryId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    const parsedCategoryId = categoryId ? Number(categoryId) : null;
    return this.service.listClubs(
      eventId,
      search ?? "",
      parsedCategoryId && Number.isFinite(parsedCategoryId) ? parsedCategoryId : null,
      page,
      pageSize,
    );
  }

  @Get("events/:id/categories")
  async listCategories(@Param("id", ParseIntPipe) eventId: number) {
    return this.service.listCategories(eventId);
  }

  @Get("events/:id/efficiency")
  @PublicCacheTtl(20)
  async listEventEfficiency(@Param("id", ParseIntPipe) eventId: number) {
    return this.service.listEventEfficiency(eventId);
  }

  @Get("events/:id/medalists")
  @PublicCacheTtl(20)
  async listEventCategoryMedalists(@Param("id", ParseIntPipe) eventId: number) {
    return this.service.listEventCategoryMedalists(eventId);
  }

  @Get("events/:id/schedule")
  @PublicCacheTtl(30)
  async listEventSchedule(@Param("id", ParseIntPipe) eventId: number) {
    return this.service.listEventSchedule(eventId);
  }

  @Get("efficiency")
  async listGlobalEfficiency(@Query("year") year?: string) {
    const parsedYear = this.parseEfficiencyYear(year);
    return this.service.listGlobalEfficiency(parsedYear);
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

  private parseEfficiencyYear(year?: string): number | undefined {
    if (year === undefined || year === null || year === "") {
      return undefined;
    }
    const parsed = Number(year);
    if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
      throw new BadRequestException("Parametro year invalido. Use um ano entre 1900 e 2100.");
    }
    return parsed;
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
  async athletesDirectory(
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.service.listAthleteDirectory(search ?? "", page, pageSize);
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
