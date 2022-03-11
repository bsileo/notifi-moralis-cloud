// content: {
//   plain: "Plain Content",
//   rich: "Rich text<br/>Content"
//   }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function sendAlert(subscription, content, messageData = {}) {
  logger.info(`[sendalert] Sending "${content.plain}" to SubID=${subscription.id}`);
  try {
  const frequencyAllowed = await checkAlertFrequency(subscription, content, messageData);
  if (!frequencyAllowed) {
    logger.info(`[SendAlert] Skipped/Queued ${subscription.id} due to frequency/group controls`);
    return;
  }
  } catch (err) {
    logger.error("Check Freq - " + err)
  }
  const relChannels = subscription.relation("UserChannel");
  const qc = relChannels.query();
  qc.equalTo("status", "Active");
  const channels = await qc.find({ useMasterKey: true });
  logger.info(`[SendAlert] Sending to ${channels.length} Channels`);
  for (let i = 0; i < channels.length; i++) {
    const chan = channels[i];
    const PID = chan.get("providerID");
    let res = null;
    if (PID == "discord") {
      res = await sendDiscordAlert(chan, content);
    } else if (PID == "twilio") {
      res = await sendTwilioAlert(chan, content);
    } else if (PID == "email") {
      res = await sendEmailAlert(chan, content, subscription, messageData);
    } else if (PID == "telegram") {
      res = await sendTelegramAlert(chan, content);
    }
    saveAlertHistory(subscription, content, res, chan);
  }
  logger.info("Update Subscription lastSent");
  subscription.set("lastSent", new Date());
  subscription.save(null, { useMasterKey: true });
  
}

async function checkAlertFrequency(subscription, content, messageData) {
  const subFreq = checkAlertSubscriptionFrequency(subscription, content, messageData);
  const groupFreq = await checkAlertGroupFrequency(subscription, content, messageData);
  return subFreq && groupFreq;
}
async function checkAlertGroupFrequency(subscription, content, messageData) {
  try {
    if (!subscription) { console.log("[checkAlertGroupFreq] No subscription"); return true; }
    const group = subscription.get("Group");
    if (!group) { console.log("[checkAlertGroupFreq] No group"); return true; }
    await group.fetch({useMasterKey: true});
    const freq = group.get("frequency");
    if (freq == "Real-time") { console.log("[checkAlertGroupFreq] Real-time"); return true };
    let aQueue = await getExistingAlertQueue(subscription);
    if (!aQueue) {
      const AQ = Moralis.Object.extend("AlertQueue");
      aQueue = new AQ();
    }
    aQueue.set("Group", group);
    aQueue.set("Subscription", subscription);
    aQueue.set("content", content);
    aQueue.set("messageData", messageData);
    aQueue.save(null, {useMasterKey: true});
    logger.info(`Alert queue for ${subscription.id} due to Group Membership`)
  }
  catch (err) {
    logger.error("Failed in checkAlertGroupFrequency - " + err);
  }
  return false;
}

async function getExistingAlertQueue(subscription) {
  const subType = subscription.get("subscriptionType");
  // No collapse for these
  if (subType == "Protocol Alerts") return;
  if (subType == "Smart Contracts") return;
  
  const query = new Moralis.Query("AlertQueue");
  query.equalTo("Subscription", subscription)
  return await query.first({useMasterKey: true});
}

function checkAlertSubscriptionFrequency(subscription, content, messageData) {
  const uf = subscription.get("userFrequency");
  if (uf == undefined || uf == "always" || uf == "") {
    // no frequency, so Ok to proceed
    return true;
  }
  const last = subscription.get("lastSent");
  if (last == undefined) {
    // First time so OK to proceed
    return true;
  }
  const now = new Date();
  const deltaRaw = now - last;
  const deltaMins = deltaRaw / ( 1000 * 60)
  let allowed = 60 // hour
  if (uf == "day") allowed = 60*24;
  logger.info(`[checkAlertFrequency]  ${uf} ${allowed} ${deltaMins} ${allowed < deltaMins} ${subscription.id}`);
  return allowed < deltaMins
}

async function saveAlertHistory(subscription, content, result, uChannel=null, group=null, alertID=null) {
  logger.info("Make AlertHistory");
  const aHist = Moralis.Object.extend("AlertHistory");
  const ah = new aHist();
  let u = null;
  if (uChannel) {
    ah.set("UserChannel", uChannel);
    u = uChannel.get("User");
  }
  if (group) {
    ah.set("group", group);
    u = group.get("User");
  }
  try {
    ah.set("User", u);
    ah.set("Subscription", subscription);
    ah.set("content", content);
    ah.set("result", result);
    ah.set("status", "Sent");
    ah.set("Protocol", subscription.get("Protocol"));
    ah.set("SubscriptionType", subscription.get("subscriptionType"))
    if (alertID) {
      ah.set("AlertID", alertID);
    }
    const cat = subscription.get("GeneralSubType");
    if (cat) {
      ah.set("Category", cat);
    }
    await ah.save(null, { useMasterKey: true });
  } catch (err) {
    logger.error(err)
    return false;
  }
  return true;
}
