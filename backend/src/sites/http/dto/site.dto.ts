import { Transform, Type } from 'class-transformer';
import { Allow, IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

const positiveInteger = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;

export class SitePropertiesDto {
  @IsString()
  @IsDefined()
  code!: string;

  @IsString()
  @IsDefined()
  name!: string;
}

export class SiteFeatureDto {
  @IsIn(['Feature'])
  type!: 'Feature';

  @IsObject()
  @Allow()
  geometry!: object;

  @ValidateNested()
  @Type(() => SitePropertiesDto)
  properties!: SitePropertiesDto;
}

export class SitePatchDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  @Allow()
  geometry?: object;
}

export class SiteListQueryDto {
  @IsOptional()
  @IsIn(['active'])
  status?: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  q?: string;

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

export class SiteGeoJsonQueryDto {
  @Allow()
  bbox?: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsIn(['active'])
  status?: string;
}
