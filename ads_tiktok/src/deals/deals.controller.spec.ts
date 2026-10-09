import { DealsService } from './deals.service';
import { DealsController } from './deals.controller';

describe('DealsController', () => {
  it('passes the requested filters to the deal service', async () => {
    const query = { status: 'open', assigned_to: '7', page: 2, limit: 25 };
    const result = { items: [], total: 0, page: 2, limit: 25 };
    const service = { list: jest.fn().mockResolvedValue(result) };
    const controller = new DealsController(service as unknown as DealsService);

    await expect(controller.list(query)).resolves.toEqual(result);
    expect(service.list).toHaveBeenCalledWith(query);
  });
});
