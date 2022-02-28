// content: {
//   plain: "Plain Content",
//   rich: "Rich text<br/>Content"
//   }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function sendAlert(subscription, content, messageData) {
  const logger = Moralis.Cloud.getLogger();
  const frequencyAllowed = checkAlertFrequency(subscription, content);
  if (!frequencyAllowed) {
    logger.info(`[SendAlert] Skipped ${subscription.id} due to frequency limit`);
    return;
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
      res = await sendEmailAlert(chan, content);
    } else if (PID == "telegram") {
      res = await sendTelegramAlert(chan, content);
    }
    saveAlertHistory(subscription, chan, content, res);
  }
}

function checkAlertFrequency(subscription, content) {
  const uf = subscription.get("userFrequency");
  if (uf == undefined || uf == "always") {
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

async function saveAlertHistory(subscription, uChannel, content, result) {
  const aHist = Moralis.Object.extend("AlertHistory");
  subscription.set("lastSent", new Date());
  subscription.save(null, { useMasterKey: true });
  const ah = new aHist();
  ah.set("UserChannel", uChannel);
  const u = uChannel.get("User");
  ah.set("User", u);
  ah.set("Subscription", subscription);
  ah.set("content", content);
  ah.set("result", result);
  ah.set("status", "Sent");
  ah.set("Protocol", subscription.get("Protocol"));
  ah.set("SubscriptionType", subscription.get("subscriptionType"))
  const category = subscription.get("GeneralSubType");
  if (category) {
    ah.set("category", cat.get("name"));
  }
  await ah.save(null, { useMasterKey: true });
  return true;
}
