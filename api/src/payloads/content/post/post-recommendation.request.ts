import { Type } from 'class-transformer';
import { IsMongoId, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';
import { SearchRequest } from 'src/kernel/common';

export class PostRecommendationRequest extends SearchRequest {
  @IsOptional()
  @IsString()
  @IsMongoId()
  @ValidateIf((request) => Boolean(request.cursor))
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @ValidateIf((request) => request.score !== undefined)
  score?: number;
}
