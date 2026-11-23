import { Transform } from 'class-transformer';
import { IsArray, IsDefined, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min, ValidateIf } from 'class-validator';

export class SurveyCreateDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lon!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDefined()
  surveyed_on!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  cover_percent!: number;

  @IsArray()
  @IsString({ each: true })
  species!: string[];

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  note?: string | null;
}

export class SurveyPatchDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lon?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  surveyed_on?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  cover_percent?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @IsString({ each: true })
  species?: string[];

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  note?: string | null;
}

const positiveInteger = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;

export class SurveyListQueryDto {
  @IsOptional()
  @Transform(positiveInteger)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page?: number;

  @IsOptional()
  @Transform(positiveInteger)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
