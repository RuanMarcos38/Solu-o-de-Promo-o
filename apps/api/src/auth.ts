import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';
import { config } from './config.js';
import { prisma } from './db.js';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

export async function ensureAdminUser() {
  const existing = await prisma.user.findUnique({ where: { email: config.adminEmail } });
  if (existing) return existing;

  const passwordHash = await bcrypt.hash(config.adminPassword, 12);

  return prisma.user.create({
    data: {
      name: config.adminName,
      email: config.adminEmail,
      passwordHash,
      role: UserRole.ADMIN
    }
  });
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  const safeUser: AuthUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  const token = jwt.sign(safeUser, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
  return { user: safeUser, token };
}

export function requireAuth(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Token não informado'), { statusCode: 401 });
  }

  const token = header.replace('Bearer ', '').trim();
  try {
    return jwt.verify(token, config.jwtSecret) as AuthUser;
  } catch {
    throw Object.assign(new Error('Token inválido ou expirado'), { statusCode: 401 });
  }
}

export function requireAdmin(request: FastifyRequest) {
  const user = requireAuth(request);
  if (user.role !== UserRole.ADMIN) {
    throw Object.assign(new Error('Permissão insuficiente'), { statusCode: 403 });
  }
  return user;
}
