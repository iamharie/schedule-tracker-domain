import { GraphQLError } from 'graphql';
import prisma from '../../config/prisma';

const CAL_SELECT = {
  id: true,
  name: true,
  color: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function assertOwns(userId: string, calendarId: string) {
  const cal = await prisma.calendar.findFirst({
    where: { id: calendarId, userId },
    select: { id: true },
  });
  if (!cal) throw new GraphQLError('Calendar not found', { extensions: { code: 'NOT_FOUND' } });
}

export async function getCalendars(userId: string) {
  return prisma.calendar.findMany({ where: { userId }, select: CAL_SELECT, orderBy: { createdAt: 'asc' } });
}

export async function createCalendar(
  userId: string,
  input: { name: string; color?: string | null; isDefault?: boolean | null },
) {
  if (input.isDefault) {
    await prisma.calendar.updateMany({ where: { userId }, data: { isDefault: false } });
  }
  return prisma.calendar.create({
    data: {
      userId,
      name: input.name,
      color: input.color ?? '#4F46E5',
      isDefault: input.isDefault ?? false,
    },
    select: CAL_SELECT,
  });
}

export async function updateCalendar(
  userId: string,
  id: string,
  input: { name?: string | null; color?: string | null; isDefault?: boolean | null },
) {
  await assertOwns(userId, id);

  if (input.isDefault) {
    await prisma.calendar.updateMany({ where: { userId, NOT: { id } }, data: { isDefault: false } });
  }

  return prisma.calendar.update({
    where: { id },
    data: {
      ...(input.name != null && { name: input.name }),
      ...(input.color != null && { color: input.color }),
      ...(input.isDefault != null && { isDefault: input.isDefault }),
    },
    select: CAL_SELECT,
  });
}

export async function deleteCalendar(userId: string, id: string): Promise<boolean> {
  await assertOwns(userId, id);
  await prisma.calendar.delete({ where: { id } });
  return true;
}
