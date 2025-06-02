


const x = ONE_MINUS_T_POW_3[i] * start.x +
  3 * ONE_MINUS_T_POW_2[i] * T[i] * startControlPoint.x +
  3 * (1 - T[i]) * T_POW_2[i] * endControlPoint.x +
  T_POW_3[i] * end.x;


const y = ONE_MINUS_T_POW_3[i] * start.y +
3 * ONE_MINUS_T_POW_2[i] * T[i] * startControlPoint.y +
3 * (1 - T[i]) * T_POW_2[i] * endControlPoint.y +
T_POW_3[i] * end.y;