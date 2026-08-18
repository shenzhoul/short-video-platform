import { Worker } from 'bullmq';

class QueueWorkersHolder {
  private list: Worker[] = [];

  public addToList(worker: Worker) {
    this.list.push(worker);
  }

  public getList() {
    return this.list;
  }

  public getByName(queueName: string) {
    return this.list.find((w) => w.name === queueName);
  }

  /**
   * it is important for Graceful Shutdown https://docs.bullmq.io/guide/workers/graceful-shutdown
   */
  public async closeWorkers() {
    await Promise.all(this.list.map((worker) => worker.close && worker.close()));
  }
}

// create a singleton by export constant, by this way QueueWorkerHolderSingleton is app-wide state
// The const here is only going to exist once, even though we're going to import this module in a few places...
export const QueueWorkerHolderSingleton = new QueueWorkersHolder();
