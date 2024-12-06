import { banner } from './utils/banner.js';
import { logger } from './utils/logger.js';
import fs from 'fs';

const getToken = async () => {
  return fs.readFileSync('token.txt', 'utf8').trim();
}

const colay = async (url, method, payloadData = null, additionalHeaders = {}) => {
  try {
    const headers = {
      "Content-Type": "application/json",
      ...additionalHeaders
    };

    const options = {
      method,
      headers,
    };

    if (payloadData) {
      options.body = JSON.stringify(payloadData);
    }

    const response = await fetch(url, options);

    if (response.status === 401) {
      logger('Unauthorized request. Triggering token revalidation...', 'warn');
      await revalidate();
      return 'REVALIDATED';
    } else if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    logger('Error:', 'error', error);
    throw error;
  }
}

const Auth = async () => {
  const token = await getToken();
  const url = "https://quest.redactedairways.com/ecom-gateway/auth";
  const headers = { "Authorization": `Bearer ${token}` };

  try {
    const data = await colay(url, 'GET', null, headers);
    logger("Auth Response:", 'info', data);
    return data;
  } catch (error) {
    logger("Error making GET request:", 'error', error);
    return null;
  }
};

const profile = async () => {
  const token = await getToken();
  const url = "https://quest.redactedairways.com/ecom-gateway/user/info";
  const headers = { "Authorization": `Bearer ${token}` };

  try {
    const data = await colay(url, 'GET', null, headers);
    if (data === 'REVALIDATED') {
      return await profile();
    }
    return data;
  } catch (error) {
    logger("Error making GET request profile:", 'error', error);
    return null;
  }
};

const revalidate = async () => {
  const token = await getToken();
  const url = "https://quest.redactedairways.com/ecom-gateway/revalidate";
  const headers = { "Authorization": `Bearer ${token}` };

  try {
    const data = await colay(url, 'POST', null, headers);
    logger("Revalidate Response:", 'info', data.token);

    const newToken = data.token;
    fs.writeFileSync('token.txt', newToken, 'utf8');
    logger("New token saved to token.txt");
    await Auth();
  } catch (error) {
    logger("Error revalidating token:", 'error', error);
  }
};

const fetchTaskList = async () => {
  const token = await getToken();
  const url = "https://quest.redactedairways.com/ecom-gateway/task/list";
  const headers = { "Authorization": `Bearer ${token}` };

  try {
    const data = await colay(url, 'GET', null, headers);
    if (data === 'REVALIDATED') {
      return await fetchTaskList();
    }

    return data.list
      .filter(task => !task.completed)
      .map(({ _id, task_action, tweet_id, twitter_id }) => ({
        _id,
        task_action,
        tweet_id: tweet_id || null,
        twitter_id: twitter_id || null
      }));
  } catch (error) {
    logger("Error fetching task list:", 'error', error);
    return [];
  }
};

const fetchTaskListPartner = async () => {
  const token = await getToken();
  const url = "https://quest.redactedairways.com/ecom-gateway/partners";
  const headers = { "Authorization": `Bearer ${token}` };

  try {
    const data = await colay(url, 'GET', null, headers);
    if (data === 'REVALIDATED') {
      return await fetchTaskListPartner();
    }

    const incompleteTasks = [];
    data.data.forEach(partner => {
      partner.tasks
        .filter(task => task.status === "incomplete")
        .forEach(task => {
          incompleteTasks.push({
            partner_id: partner._id,
            task_type: task.task_type
          });
        });
    });
    return incompleteTasks;
  } catch (error) {
    logger("Error fetching partner tasks:", 'error', error);
    return [];
  }
};

const doTask = async (action, taskId, resourceId) => {
  const token = await getToken();
  const urlMap = {
    follow: "https://quest.redactedairways.com/ecom-gateway/task/follow",
    retweet: "https://quest.redactedairways.com/ecom-gateway/task/retweet",
    like: "https://quest.redactedairways.com/ecom-gateway/task/like"
  };

  const payload = {
    taskId,
    twitterId: action === "follow" ? resourceId : undefined,
    tweetId: action !== "follow" ? resourceId : undefined
  };

  const headers = { "Authorization": `Bearer ${token}` };

  try {
    const response = await colay(urlMap[action], 'POST', payload, headers);
    if (response === 'REVALIDATED') {
      return await doTask(action, taskId, resourceId);
    }

    logger(`Task ${action} successful`, 'success', response);
  } catch (error) {
    logger(`Error performing task ${action}:`, 'error', error);
  }
};

const doTaskPartner = async (partnerId, taskType) => {
  const token = await getToken();
  const url = "https://quest.redactedairways.com/ecom-gateway/partnerActivity";
  const payload = { partnerId, taskType };
  const headers = { "Authorization": `Bearer ${token}` };

  try {
    const response = await colay(url, 'POST', payload, headers);
    if (response === 'REVALIDATED') {
      return await doTaskPartner(partnerId, taskType);
    }
    logger("Partner task successful", 'success', response);
  } catch (error) {
    logger("Error performing partner task:", 'error', error);
  }
};

const main = async () => {
  logger(banner, 'debug')

  while (true) {
    const info = await profile()
    const name = info.userData.username;
    const id = info.userData._id;
    const score = info.userData.overall_score;
    logger(`User: ${name} - ID: ${id} - Score: ${score}`)
    const taskList = await fetchTaskList();
    logger("Found tasks:", 'info', taskList.length);

    for (const task of taskList) {
      if (task.task_action === "telegram-auth") {
        logger('its a telegram auth task Skipping...', 'warn');
        continue;
      } else {
        await doTask(task.task_action, task._id, task.twitter_id || task.tweet_id);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    const partnerTaskList = await fetchTaskListPartner();
    if (partnerTaskList.length > 0) {
      logger("Found partner tasks:", 'info', partnerTaskList.length);
    } else {
      logger("No partner tasks found");
    }

    for (const task of partnerTaskList) {
      await doTaskPartner(task.partner_id, task.task_type);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger("Cooldown 1 hour before checking for new tasks...");
    await new Promise(resolve => setTimeout(resolve, 60 * 60 * 1000));
  }
};

main();
