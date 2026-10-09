import { AppDataSource } from './data-source';

AppDataSource.initialize()
  .then((ds) => ds.runMigrations())
  .then((m) => {
    console.log(`Đã chạy ${m.length} bản cập nhật cấu trúc cơ sở dữ liệu`);
    return AppDataSource.destroy();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
