import { BadRequestException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query, Body, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { ApiErrorEnvelope } from '../../platform/http';
import { parseSurveyId, parseSurveyInput } from './survey-validation';
import { SURVEY_CREATE_BODY_SCHEMA, SURVEY_ERROR_SCHEMA, SURVEY_LIST_SCHEMA, SURVEY_PATCH_BODY_SCHEMA, SURVEY_WRITE_SCHEMA } from './survey-openapi';
import { AuthGuard, Roles, type AuthenticatedRequest } from '../../auth/auth.module';
import { SURVEY_LIST_REPOSITORY, type SurveyListRepository } from '../application/contracts/survey-list-repository';
import { SurveyCommands } from '../application/use-cases/survey-commands';
import { SurveyCreateDto, SurveyListQueryDto, SurveyPatchDto } from './dto/survey.dto';

@ApiExtraModels(ApiErrorEnvelope)
@ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SURVEY_ERROR_SCHEMA })
@Controller()
export class SurveysController {
  constructor(
    @Inject(SURVEY_LIST_REPOSITORY) private readonly surveyLists: SurveyListRepository,
    private readonly surveyCommands: SurveyCommands,
  ) {}


  @Get('sites/:code/surveys')
  @UseGuards(AuthGuard)
  @Roles('viewer', 'editor', 'admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ description: 'Requires an active viewer, editor, or admin. Each item includes its creator user ID, or null for imported Surveys.' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, schema: SURVEY_LIST_SCHEMA })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 403, description: 'FORBIDDEN', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 404, description: 'SITE_NOT_FOUND', schema: SURVEY_ERROR_SCHEMA })
  async list(@Param('code') code: string, @Query() query: SurveyListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (page > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) throw new BadRequestException();
    const result = await this.surveyLists.listBySiteCode(code, page, pageSize);
    if (!result) throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site not found', details: {} });
    return result;
  }

  @UseGuards(AuthGuard)
  @Roles('admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ description: 'Requires an active admin.' })
  @Post('sites/:code/surveys')
  @ApiBody({ schema: SURVEY_CREATE_BODY_SCHEMA })
  @ApiResponse({ status: 201, schema: SURVEY_WRITE_SCHEMA })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 403, description: 'FORBIDDEN', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 404, description: 'SITE_NOT_FOUND', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 422, description: 'OUTSIDE_SITE', schema: SURVEY_ERROR_SCHEMA })
  async create(@Param('code') code: string, @Body() body: SurveyCreateDto, @Req() request: AuthenticatedRequest & { rawBody?: Buffer }) {
    const input = parseSurveyInput(body, true, request.rawBody);
    return this.surveyCommands.create(code, input, request.user.id);
  }

  @Patch('surveys/:id')
  @UseGuards(AuthGuard)
  @Roles('admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ description: 'Requires an active admin. Records the authenticated updater on every successful update.' })
  @ApiBody({ schema: SURVEY_PATCH_BODY_SCHEMA })
  @ApiResponse({ status: 200, schema: SURVEY_WRITE_SCHEMA })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 403, description: 'FORBIDDEN', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 404, description: 'SURVEY_NOT_FOUND', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 422, description: 'OUTSIDE_SITE', schema: SURVEY_ERROR_SCHEMA })
  async update(@Param('id') rawId: string, @Body() body: SurveyPatchDto, @Req() request: AuthenticatedRequest & { rawBody?: Buffer }) {
    const id = parseSurveyId(rawId);
    const input = parseSurveyInput(body, false, request.rawBody);
    return this.surveyCommands.update(id, input, request.user.id);
  }

  @UseGuards(AuthGuard)
  @Roles('admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ description: 'Requires an active admin.' })
  @Delete('surveys/:id')
  @HttpCode(204)
  @ApiResponse({ status: 204, description: 'Survey deleted' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 403, description: 'FORBIDDEN', schema: SURVEY_ERROR_SCHEMA })
  @ApiResponse({ status: 404, description: 'SURVEY_NOT_FOUND', schema: SURVEY_ERROR_SCHEMA })
  async remove(@Param('id') rawId: string): Promise<void> {
    return this.surveyCommands.remove(parseSurveyId(rawId));
  }
}
