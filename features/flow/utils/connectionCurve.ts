interface Point {
  x: number;
  y: number;
}

/**
 * 计算两个节点之间的连接曲线路径
 * @param start 起点坐标
 * @param end 终点坐标
 * @returns 曲线路径点数组
 */
const STEPS = 50
const T = Array.from({ length: STEPS + 1 }, (_, i) => i / STEPS);
const ONE_MINUS_T_POW_3 = T.map(t => Math.pow(1 - t, 3));
const ONE_MINUS_T_POW_2 = T.map(t => Math.pow(1 - t, 2));
const T_POW_3 = T.map(t => Math.pow(t, 3));
const T_POW_2 = T.map(t => Math.pow(t, 2));

export const calculateConnectionPath = (start: Point, end: Point): Point[] => {
  // 计算控制点
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // 控制点的水平偏移量（可以根据需要调整）
  const controlPointOffset = Math.abs(dx) * 0.5;

  // 起点控制点
  const startControlPoint = {
    x: start.x + controlPointOffset,
    y: start.y
  };

  // 终点控制点
  const endControlPoint = {
    x: end.x - controlPointOffset,
    y: end.y
  };

  // 生成曲线上的点
  const points: Point[] = [];
  // const steps = 50; 
  
  for (let i = 0; i <= STEPS; i++) {
    // const t = i / steps;
 
    // // 三次贝塞尔曲线公式
    // const x = Math.pow(1 - t, 3) * start.x +
    //   3 * Math.pow(1 - t, 2) * t * startControlPoint.x +
    //   3 * (1 - t) * Math.pow(t, 2) * endControlPoint.x +
    //   Math.pow(t, 3) * end.x;

    // const y = Math.pow(1 - t, 3) * start.y +
    //   3 * Math.pow(1 - t, 2) * t * startControlPoint.y +
    //   3 * (1 - t) * Math.pow(t, 2) * endControlPoint.y +
    //   Math.pow(t, 3) * end.y;
    const x = ONE_MINUS_T_POW_3[i] * start.x +
      3 * ONE_MINUS_T_POW_2[i] * T[i] * startControlPoint.x +
      3 * (1 - T[i]) * T_POW_2[i] * endControlPoint.x +
      T_POW_3[i] * end.x;


    const y = ONE_MINUS_T_POW_3[i] * start.y +
      3 * ONE_MINUS_T_POW_2[i] * T[i] * startControlPoint.y +
      3 * (1 - T[i]) * T_POW_2[i] * endControlPoint.y +
      T_POW_3[i] * end.y;
    points.push({ x, y });
  }
  console.log("计算完成")

  return points;
};

/**
 * 将点数组转换为SVG路径字符串
 * @param points 点数组
 * @returns SVG路径字符串
 */
export const pointsToPath = (points: Point[]): string => {
  if (points.length === 0) return '';

  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ` +
    rest.map(p => `L ${p.x} ${p.y}`).join(' ');
}; 