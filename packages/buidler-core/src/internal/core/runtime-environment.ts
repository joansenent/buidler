import debug from "debug";

import {
  BuidlerArguments,
  BuidlerRuntimeEnvironment,
  EnvironmentExtender,
  EthereumProvider,
  Network,
  ResolvedBuidlerConfig,
  RunSuperFunction,
  RunTaskFunction,
  TaskArguments,
  TaskDefinition,
  TasksMap
} from "../../types";
import { lazyObject } from "../util/lazy";

import { BuidlerError } from "./errors";
import { ERRORS } from "./errors-list";
import { createProvider } from "./providers/construction";
import { OverriddenTaskDefinition } from "./tasks/task-definitions";

const log = debug("buidler:core:bre");

export class Environment implements BuidlerRuntimeEnvironment {
  private static readonly _BLACKLISTED_PROPERTIES: string[] = [
    "injectToGlobal",
    "_runTaskDefinition"
  ];

  /**
   * An EIP1193 Ethereum provider.
   */
  public ethereum: EthereumProvider;

  public network: Network;

  private readonly _extenders: EnvironmentExtender[];

  /**
   * Initializes the Buidler Runtime Environment and the given
   * extender functions.
   *
   * @remarks The extenders' execution order is given by the order
   * of the requires in the buidler's config file and its plugins.
   *
   * @param config The buidler's config object.
   * @param buidlerArguments The parsed buidler's arguments.
   * @param tasks A map of tasks.
   * @param extenders A list of extenders.
   */
  constructor(
    public readonly config: ResolvedBuidlerConfig,
    public readonly buidlerArguments: BuidlerArguments,
    public readonly tasks: TasksMap,
    extenders: EnvironmentExtender[] = []
  ) {
    log("Creating BuidlerRuntimeEnvironment");

    const networkName =
      buidlerArguments.network !== undefined
        ? buidlerArguments.network
        : config.defaultNetwork;

    const networkConfig = config.networks[networkName];

    if (networkConfig === undefined) {
      throw new BuidlerError(ERRORS.NETWORK.CONFIG_NOT_FOUND, {
        network: networkName
      });
    }

    const provider = lazyObject(() => {
      log(`Creating provider for network ${networkName}`);
      return createProvider(
        networkName,
        networkConfig,
        config.solc.version,
        config.paths
      );
    });

    this.network = {
      name: networkName,
      config: config.networks[networkName],
      provider
    };

    this.ethereum = provider;
    this._extenders = extenders;

    extenders.forEach(extender => extender(this));
  }

  /**
   * Executes the task with the given name.
   *
   * @param name The task's name.
   * @param taskArguments A map of task's arguments.
   *
   * @throws a BDLR303 if there aren't any defined tasks with the given name.
   * @returns a promise with the task's execution result.
   */
  public readonly run: RunTaskFunction = async (name, taskArguments = {}) => {
    const taskDefinition = this.tasks[name];

    log("Running task %s", name);

    if (taskDefinition === undefined) {
      throw new BuidlerError(ERRORS.ARGUMENTS.UNRECOGNIZED_TASK, {
        task: name
      });
    }

    return this._runTaskDefinition(taskDefinition, taskArguments);
  };

  /**
   * Injects the properties of `this` (the Buidler Runtime Environment) into the global scope.
   *
   * @param blacklist a list of property names that won't be injected.
   *
   * @returns a function that restores the previous environment.
   */
  public injectToGlobal(
    blacklist: string[] = Environment._BLACKLISTED_PROPERTIES
  ): () => void {
    const globalAsAny = global as any;

    const previousValues: { [name: string]: any } = {};

    for (const [key, value] of Object.entries(this)) {
      if (blacklist.includes(key)) {
        continue;
      }

      previousValues[key] = globalAsAny[key];
      globalAsAny[key] = value;
    }

    return () => {
      for (const [key, _] of Object.entries(this)) {
        if (blacklist.includes(key)) {
          continue;
        }

        globalAsAny[key] = previousValues[key];
      }
    };
  }

  private async _runTaskDefinition(
    taskDefinition: TaskDefinition,
    taskArguments: TaskArguments
  ) {
    const isOverridenTask = taskDefinition instanceof OverriddenTaskDefinition;
    const { name: taskName } = taskDefinition;

    const runSuperFunction: RunSuperFunction<TaskArguments> = async (
      _taskArguments: TaskArguments = taskArguments
    ) => {
      if (!isOverridenTask) {
        throw new BuidlerError(ERRORS.TASK_DEFINITIONS.RUNSUPER_NOT_AVAILABLE, {
          taskName
        });
      }
      log("Running %s's super", taskName);
      const {
        parentTaskDefinition
      } = taskDefinition as OverriddenTaskDefinition;

      return this._runTaskDefinition(parentTaskDefinition, _taskArguments);
    };

    runSuperFunction.isDefined = isOverridenTask;

    const globalAsAny = (global as unknown) as {
      runSuper: RunSuperFunction<TaskArguments>;
    };

    const previousRunSuper = globalAsAny.runSuper;
    globalAsAny.runSuper = runSuperFunction;

    const uninjectFromGlobal = this.injectToGlobal();

    try {
      // here the task action is excuted. This is the actual logic (might be user defined).
      return await taskDefinition.action(taskArguments, this, runSuperFunction);
    } finally {
      uninjectFromGlobal();
      globalAsAny.runSuper = previousRunSuper;
    }
  }
}
