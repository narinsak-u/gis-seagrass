import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class LoginDto {
  @IsString()
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
