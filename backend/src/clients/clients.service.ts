import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Client } from '../db/entities/client.entity';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly repo: Repository<Client>,
  ) {}

  async list(includeInactive = false) {
    return this.repo.find({
      where: includeInactive ? {} : { active: true },
      order: { name: 'ASC' },
    });
  }

  async create(name: string, key: string) {
    const existing = await this.repo.findOne({ where: { key } });
    if (existing) throw new ConflictException(`A client with key "${key}" already exists`);
    const client = this.repo.create({ name, key, active: true });
    return this.repo.save(client);
  }

  async rename(id: string, name: string) {
    const client = await this.repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Client not found');
    client.name = name;
    return this.repo.save(client);
  }

  async setActive(id: string, active: boolean) {
    const client = await this.repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Client not found');
    client.active = active;
    return this.repo.save(client);
  }
}
