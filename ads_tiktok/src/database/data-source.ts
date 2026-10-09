import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as entities from './entities';
import { InitSchema1700000000000 } from './migrations/1700000000000-InitSchema';
import { PersistBitrixMock1700000001000 } from './migrations/1700000001000-PersistBitrixMock';
import { Reliability1700000002000 } from './migrations/1700000002000-Reliability';
import { LeadExtraContacts1700000003000 } from './migrations/1700000003000-LeadExtraContacts';
import { BitrixModeNamespace1700000004000 } from './migrations/1700000004000-BitrixModeNamespace';
import { databaseOptions } from '../config/infrastructure';
import { NotificationOutbox1700000005000 } from './migrations/1700000005000-NotificationOutbox';

export const AppDataSource = new DataSource({
  ...databaseOptions(process.env),
  entities: Object.values(entities),
  migrations: [
    InitSchema1700000000000,
    PersistBitrixMock1700000001000,
    Reliability1700000002000,
    LeadExtraContacts1700000003000,
    BitrixModeNamespace1700000004000,
    NotificationOutbox1700000005000,
  ],
  synchronize: false,
});
