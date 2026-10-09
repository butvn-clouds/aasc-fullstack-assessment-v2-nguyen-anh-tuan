import { Bitrix24ClientService } from './bitrix24-client.service';

describe('safe CRM batch retries', () => {
  function setup(maxRetries = 2) {
    const client = new Bitrix24ClientService({
      getOrThrow: () => 'https://example.com/rest/1/test/',
      get: (key: string) => (key === 'SYNC_MAX_RETRIES' ? maxRetries : 0),
    } as any);
    const call = jest.spyOn(client, 'call');
    return { client, call };
  }
  const quota = { error: 'QUERY_LIMIT_EXCEEDED' };

  it('retries only explicit quota failures, preserving successful add commands', async () => {
    const { client, call } = setup();
    call
      .mockResolvedValueOnce({ result: { a: 101 }, result_error: { b: quota } })
      .mockResolvedValueOnce({ result: { b: 102 } });
    expect(await client.batchWrite({ a: 'crm.lead.add?x=1', b: 'crm.lead.add?x=2' })).toEqual({
      result: { a: 101, b: 102 },
      result_error: {},
    });
    expect(call.mock.calls[1]).toEqual(['batch', { halt: 0, cmd: { b: 'crm.lead.add?x=2' } }, 0]);
  });

  it('returns exhausted quota errors and permanent errors separately', async () => {
    const { client, call } = setup(1);
    call
      .mockResolvedValueOnce({
        result: {},
        result_error: { a: quota, b: { error: 'INVALID_FIELD' } },
      })
      .mockResolvedValueOnce({ result: {}, result_error: { a: quota } });
    expect(await client.batchWrite({ a: 'a', b: 'b' })).toEqual({
      result: {},
      result_error: { a: quota, b: { error: 'INVALID_FIELD' } },
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1][1]).toEqual({ halt: 0, cmd: { a: 'a' } });
  });

  it('does not replay an ambiguous whole-request failure', async () => {
    const { client, call } = setup();
    call.mockRejectedValue(new Error('timeout'));
    await expect(client.batchWrite({ a: 'a' })).rejects.toThrow('timeout');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('preserves success if a later quota retry loses its response', async () => {
    const { client, call } = setup();
    call
      .mockResolvedValueOnce({ result: { a: 101 }, result_error: { b: quota } })
      .mockRejectedValueOnce(new Error('timeout'));
    expect(await client.batchWrite({ a: 'a', b: 'b' })).toMatchObject({
      result: { a: 101 },
      result_error: { b: { error: 'UNCERTAIN_WRITE' } },
    });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('reports missing results without retrying a potentially successful create', async () => {
    const { client, call } = setup();
    call.mockResolvedValueOnce({ result: {} });
    expect(await client.batchWrite({ a: 'a' })).toMatchObject({
      result_error: { a: { error: 'MISSING_RESULT' } },
    });
    expect(call).toHaveBeenCalledTimes(1);
  });
});
