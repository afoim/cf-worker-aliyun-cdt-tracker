/**
 * 阿里云 CDT 流量监控 & ECS 控制脚本 (Cloudflare Worker)
 * * 必须配置的环境变量:
 * - ACCESS_KEY_ID: 阿里云 Access Key ID
 * - ACCESS_KEY_SECRET: 阿里云 Access Key Secret
 * - REGION_ID: ECS 所在地域 ID (例如: cn-hongkong)
 * - ECS_INSTANCE_ID: ECS 实例 ID
 * - TRAFFIC_THRESHOLD_GB: 流量阈值 GB (默认: 180)
 */

export default {
  async scheduled(event, env, ctx) {
    console.log("定时任务已触发");
    await handleSchedule(env);
  },

  async fetch(request, env, ctx) {
    await handleSchedule(env);
    return new Response("执行成功", { status: 200 });
  }
};

async function handleSchedule(env) {
  const {
    ACCESS_KEY_ID,
    ACCESS_KEY_SECRET,
    REGION_ID,
    ECS_INSTANCE_ID
  } = env;

  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET || !REGION_ID || !ECS_INSTANCE_ID) {
    console.error("缺少必要的环境变量配置。");
    return;
  }

  try {
    const trafficInfo = await getInstanceUsedTrafficGB(env, ECS_INSTANCE_ID);
    if (trafficInfo.isMatched) {
      console.log(`实例 ${ECS_INSTANCE_ID} 的 CDT 已用流量: ${trafficInfo.trafficGB.toFixed(2)} GB`);
    } else {
      console.log(`未匹配到特定实例，实例 ${ECS_INSTANCE_ID} 的备选总流量: ${trafficInfo.trafficGB.toFixed(2)} GB`);
    }

    const instanceStatus = await getEcsStatus(env, ECS_INSTANCE_ID);
    console.log(`ECS 实例 ${ECS_INSTANCE_ID} 当前状态: ${instanceStatus}`);

    if (instanceStatus === "Running" || instanceStatus === "Starting") {
      console.log("实例已在运行中或正在启动。");
      return;
    }

    if (instanceStatus === "Stopped") {
      console.log("实例处于停止状态。正在尝试启动...");
      await startEcsInstance(env, ECS_INSTANCE_ID);
      return;
    }

    if (instanceStatus === "Stopping") {
      console.log("实例正在停止中。等待中...");
      return;
    }

    console.log(`实例状态异常 (${instanceStatus})。正在尝试强制重启...`);
    await rebootEcsInstance(env, ECS_INSTANCE_ID);

  } catch (error) {
    console.error("执行过程中发生错误:", error);
  }
}

// ================== 阿里云 ECS API 接口 ==================

async function getInstanceUsedTrafficGB(env, instanceId) {
  const params = {
    Action: 'ListCdtInternetTraffic',
    Version: '2021-08-13'
  };

  const result = await requestAliyun(env, 'cdt.aliyuncs.com', params);
  const trafficDetailsRaw = result?.TrafficDetails;
  const trafficDetails = Array.isArray(trafficDetailsRaw)
    ? trafficDetailsRaw
    : Array.isArray(trafficDetailsRaw?.TrafficDetail)
      ? trafficDetailsRaw.TrafficDetail
      : [];

  let totalBytes = 0;
  let matchedBytes = 0;
  let matchedCount = 0;

  for (const detail of trafficDetails) {
    const trafficValue = Number(detail?.Traffic ?? detail?.TrafficBytes ?? 0);
    const trafficBytes = Number.isFinite(trafficValue) ? trafficValue : 0;
    totalBytes += trafficBytes;

    const resourceId = String(
      detail?.ResourceId ??
      detail?.InstanceId ??
      detail?.ProductInstanceId ??
      detail?.Id ??
      ''
    );

    if (resourceId === instanceId) {
      matchedBytes += trafficBytes;
      matchedCount += 1;
    }
  }

  if (matchedCount > 0) {
    return {
      trafficGB: matchedBytes / (1024 ** 3),
      isMatched: true
    };
  }

  return {
    trafficGB: totalBytes / (1024 ** 3),
    isMatched: false
  };
}

async function getEcsStatus(env, instanceId) {
  const params = {
    Action: 'DescribeInstances',
    Version: '2014-05-26',
    RegionId: env.REGION_ID,
    InstanceIds: JSON.stringify([instanceId])
  };

  const result = await requestAliyun(env, `ecs.${env.REGION_ID}.aliyuncs.com`, params);
  const instances = result.Instances?.Instance || [];

  if (instances.length === 0) {
    throw new Error("未找到指定的 ECS 实例");
  }

  return instances[0].Status;
}

async function startEcsInstance(env, instanceId) {
  const params = {
    Action: 'StartInstance',
    Version: '2014-05-26',
    RegionId: env.REGION_ID,
    InstanceId: instanceId
  };

  return await requestAliyun(env, `ecs.${env.REGION_ID}.aliyuncs.com`, params);
}

async function rebootEcsInstance(env, instanceId) {
  const params = {
    Action: 'RebootInstance',
    Version: '2014-05-26',
    RegionId: env.REGION_ID,
    InstanceId: instanceId,
    ForceStop: 'false'
  };

  return await requestAliyun(env, `ecs.${env.REGION_ID}.aliyuncs.com`, params);
}

// ================== 核心请求与签名逻辑 ==================

async function requestAliyun(env, domain, params) {
  const method = 'POST';

  const finalParams = {
    ...params,
    AccessKeyId: env.ACCESS_KEY_ID,
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  };

  const signature = await sign(finalParams, env.ACCESS_KEY_SECRET, method);
  finalParams.Signature = signature;

  const queryString = Object.keys(finalParams)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(String(finalParams[key]))}`)
    .join('&');

  const url = `https://${domain}/?${queryString}`;

  const response = await fetch(url, {
    method: method
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`阿里云 API 响应错误: ${response.status} ${response.statusText} - ${text}`);
  }

  return await response.json();
}

async function sign(params, accessKeySecret, method) {
  const canonicalizedQueryString = Object.keys(params)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(String(params[key]))}`)
    .join('&');

  const stringToSign =
    method.toUpperCase() + '&' +
    percentEncode('/') + '&' +
    percentEncode(canonicalizedQueryString);

  const key = accessKeySecret + '&';

  return await hmacSha1(key, stringToSign);
}

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

async function hmacSha1(key, data) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const dataData = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    dataData
  );

  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
