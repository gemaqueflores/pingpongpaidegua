import { IsInt, Min } from "class-validator";

export class ResolveAthleteConflictDto {
  @IsInt()
  @Min(1)
  athleteId!: number;
}