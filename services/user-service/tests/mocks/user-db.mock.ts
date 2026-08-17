export class FakeUserDatabase {
  public readonly users = new Map<
    string,
    { id: string; name: string; email: string; createdAt: Date; updatedAt: Date }
  >();

  public readonly user = {
    create: async ({ data }: { data: { id: string; name: string; email: string } }) => {
      if (Array.from(this.users.values()).some((u) => u.email === data.email)) {
        const error = new Error("Unique constraint failed on the fields: (`email`)");
        (error as { code?: string }).code = "P2002";
        throw error;
      }
      const row = {
        id: data.id,
        name: data.name,
        email: data.email,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.users.set(row.id, row);
      return row;
    },
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id) return this.users.get(where.id) ?? null;
      if (where.email) return Array.from(this.users.values()).find((u) => u.email === where.email) ?? null;
      return null;
    },
    findMany: async ({ skip = 0, take = 20 }: { skip?: number; take?: number } = {}) =>
      Array.from(this.users.values())
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
        .slice(skip, skip + take)
  };

  async $connect() {}
  async $disconnect() {}
  async $executeRawUnsafe() {}
  async $queryRaw() {
    return [{ ready: 1 }];
  }
}
