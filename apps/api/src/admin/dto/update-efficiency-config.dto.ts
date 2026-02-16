import { IsInt, Min } from "class-validator";

export class UpdateEfficiencyConfigDto {
  @IsInt()
  @Min(0)
  pesoOuro!: number;

  @IsInt()
  @Min(0)
  pesoPrata!: number;

  @IsInt()
  @Min(0)
  pesoBronze!: number;
}
