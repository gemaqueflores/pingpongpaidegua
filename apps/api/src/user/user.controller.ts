import { Body, Controller, Get, Inject, Param, ParseIntPipe, Post, Query } from "@nestjs/common";
import { UserService } from "./user.service";
import { AthleteSummaryQueryDto } from "./dto/athlete-summary-query.dto";
import { ReportProblemDto } from "./dto/report-problem.dto";

@Controller()
export class UserController {
  private readonly service: UserService;

  constructor(@Inject(UserService) service: UserService) {
    this.service = service;
  }

  @Get("events")
  async listEvents() {
    return this.service.listEvents();
  }

  @Get("events/:id/athletes")
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
  async athleteSummary(
    @Param("id", ParseIntPipe) eventId: number,
    @Param("athleteId", ParseIntPipe) athleteId: number,
    @Query() query: AthleteSummaryQueryDto,
  ) {
    return this.service.getAthleteSummary(eventId, athleteId, query.orderBy ?? "phase_hierarchy_datetime");
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
