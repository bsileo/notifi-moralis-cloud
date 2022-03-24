/* eslint-disable no-undef */
// eslint-disable-next-line no-undef
Moralis.Cloud.beforeSave(
  "Subscription",
  async (request) => {
    await checkUserStakingLevels(request);
  },
);

async function checkUserStakingLevels(request) {
  if (request.user) {
    const subCount = await getUserSubscriptionCount(request.user);
    const subLimit = await getUserSubscriptionLimit(request.user);
    logger.info(
      `[checkUserStakingLevels] ${request.user.id} - ${subCount} ?> ${subLimit}`
    );
    if (subCount >= subLimit) {
      const level = await getUserLevel(user)
      throw `Your staking level is to low to add more Subscriptions - Users at level '${level}' are lmited to ${subLimit}`;
    }
  }
}

Moralis.Cloud.afterSave("Subscription", async (request) => {
  const { object: sub, context } = request;
  updateUserChannelSubscriptions(sub, false);
  const type = sub.get("subscriptionType");
  if (type == "Smart Contracts") {
    processSmartContractSubscription(sub);
  } else if (type == "Smart Wallet Alerts") {
    processSmartWalletSubscription(sub);
  }

});

Moralis.Cloud.afterDelete("Subscription", async (request) => {
  const logger = Moralis.Cloud.getLogger();
  const { object: sub, context } = request;
  logger.info(`[subscription.afterDelete()] `);
  updateUserChannelSubscriptions(sub, true);
  cleanupAlertQueues(sub);
  const type = sub.get("subscriptionType");
  if (type == "Smart Contracts") {
    processSmartContractSubscriptionDelete(sub);
  } else if (type == "Smart Wallet Alerts") {
    processSmartWalletSubscriptionDelete(sub);
  }
});

async function cleanupAlertQueues(sub) {
  try {
    const query = new Moralis.Query("AlertQueue");
    query.equalTo("Subscription", sub);
    const aqs = await query.find({useMasterKey: true});
    aqs.forEach( async (aq) => {
        aq.destroy({useMasterKey: true});
    })
  } catch (err) {
    logger.err("[cleanupAlertQueue] " + err)
  }
}

// Add me as a subscription on all of my current UserChannels for 2 way M:N relation support
async function updateUserChannelSubscriptions(sub, remove) {
  try {
    const rel = sub.relation("UserChannel")
    const q = rel.query();
    const chans = await q.find({useMasterKey: true})
    for (let i=0; i < chans.length; i++) {
      const ucrel = chans[i].relation("subscriptions");
      if (remove == true) {
        ucrel.remove(sub);
      } else {
        ucrel.add(sub);
      }
      chans[i].save(null, {useMasterKey: true})
    }
  } catch (err) {
    logger.error("[updateUserChannelSubscriptions] - " + err)
  }
}

/* eslint-disable no-undef */
Moralis.Cloud.define("processSmartContract", async (request) => {
  logger.info("[SmartContract] Starting SmartContract Processing");
  try {
    const subID = request.params.subscriptionID;
    logger.info("[SmartContract] A " + subID);
    const query = new Moralis.Query("Subscription");
    logger.info("[SmartContract] B");
    const sub = await query.get(subID, {useMasterKey: true});
    logger.info(`[SmartContract] ${sub}`);
    if (sub) {
      logger.info(`SmartContract SUB ${sub.id}:${sub.get("name")}`);
      return await processSmartContractSubscription(sub);
    } else {
      logger.error(`Failed to locate Subscription ${subID}`);
      throw "Failed to locate Subscription"
    }
  }
  catch (err) {
    logger.error(`[SmartContract] ${err}`);
    throw err;
  }
})


async function processSmartContractSubscription(sub) {
  logger.info(`[processSmartContractSub] ${sub.id}`);
  return await setupSmartContractWatch(sub);
}

async function setupSmartContractWatch(sub) {
  const logger = Moralis.Cloud.getLogger();
  let contract = sub.get("contract");
  contract = await contract.fetch({ useMasterKey: true });
  let activity = sub.get("contractActivity");
  activity = await activity.fetch({ useMasterKey: true });
  let prot = sub.get("Protocol");
  prot = await prot.fetch({ useMasterKey: true });
  const tableName = await getTableName(prot, contract, activity);
  logger.info(`[setupSmartContractWatch] TableName= ${tableName}`);
  const watching = await checkForWatch(tableName);
  if (!watching) {
    logger.info("[setupSmartContractWatch] Not watching - build Options:");
    try {
      const abi = JSON.parse(activity.get("ABI"));
      logger.info("[setupSmartContractWatch] ABI Parsed");
      //const abi = eval("(" + activity.get("ABI") + ")");
      const chainID = getChainID(activity);
      const options = {
        tableName: tableName,
        chainId: chainID,
        address: contract.get("address"),
        topic: activity.get("topic"),
        abi: abi,
        sync_historical: false,
      };
      
      const opt = JSON.stringify(options)
      logger.info("[setupSmartContractWatch] Options: " + opt);
      const wceResult = await Moralis.Cloud.run("watchContractEvent", options, {
        useMasterKey: true,
      });
      logger.info(
        `[setupSmartContractWatch] watchContractEvent--${wceResult.success}:${wceResult.error}`
      );
      if (wceResult.success) {
        Moralis.Cloud.beforeConsume(tableName, (event) => {
          return event && event.confirmed;
        });
        return {success: true, result: "New Watch Started on " + tableName}
      } else {
        logger.error("Watch Setup Failed - " + wceResult.error);
        return {success: false, result: wceResult.error}
      }
    } catch (err) {
      logger.error("Watch Setup error - " + err.message);
      return {success: false, result: err.message}
    }
  } else {
    logger.info("[setupSmartContractWatch] Already watching:" + tableName);
    return {success: true, result: "Already Watching"}
  }
}

async function checkForWatch(tableName) {
  const q = new Moralis.Query("_EventSyncStatus");
  q.equalTo("tableName", tableName);
  const count = await q.count({ useMasterKey: true });
  return count !== 0;
}

function getChainID(act) {
  const chain = act.get("chain");
  switch (chain) {
    case "avalanche":
      return "0xa86a";
    case "eth":
      return "0x1";
    default:
      throw "Unsupported chain in [trigger].getChainID";
  }
}

function getTableName(prot, contract, activity) {
  const logger = Moralis.Cloud.getLogger();
  logger.info(`[GetTableName]  P=${prot.id} C=${contract.id} A=${activity.id}`);
  logger.info(`[GetTableName] CN=${contract.attributes}`);
  logger.info(`[GetTableName] PN=${prot.attributes}`);

  const pname = prot.get("name").replace(/[-+()_/.\s0-9]/g, "");
  const cname = contract.get("name").replace(/[-+()_/.\s0-9]/g, "");
  const act = activity.get("name").replace(/[-+()_/.\s0-9]/g, "");
  return `${pname}${cname}${act}`;
}

async function processSmartContractSubscriptionDelete(sub) {
  logger.info(`[processSmartContractSubDelete] `);
  let error = ""
  let result = false;
  try {
    let contract = sub.get("contract");
    contract = await contract.fetch({ useMasterKey: true });
    const subQ = new Moralis.Query("Subscription")
    subQ.equalTo("contract", contract)
    const subCount = await subQ.count({useMasterKey: true})
    if (subCount != 0) {
      logger.info(`[processSmartContractSubDelete] Still has subs`);
      return;
    }
    let activity = sub.get("contractActivity");
    activity = await activity.fetch({ useMasterKey: true });
    let prot = sub.get("Protocol");
    prot = await prot.fetch({ useMasterKey: true });
    const tableName = getTableName(prot, contract, activity);
    logger.info(`[processSmartContractSubDelete] TableName= ${tableName}`);
    let unwatchOptions = { tableName: tableName };
    wcr = await Moralis.Cloud.run("unwatchContractEvent", unwatchOptions, {
      useMasterKey: true,
    });
    result = wcr.result;
  } catch (err) {
    result = false;
    error = err;
    logger.error(`[processSmartContractSubDelete] - ${err}`);
  }
  finally {
    logger.info(`[processSmartContractSubDelete] Res= ${result}`);
    return {result: result, error: error};
  }
}

function processSmartWalletSubscription(sub) {
  // logger.info(`[processSmartWalletSub] `);
}

function processSmartWalletSubscriptionDelete(sub) {
  //logger.info(`[processSmartWalletSubDelete] `);
}
