import React, {useMemo} from 'react';
import Chart, {Props} from 'react-apexcharts';

type TrendPoint = {
  label: string;
  value: number;
};

type MiningTrendChartProps = {
  color?: string;
  points: TrendPoint[];
};

export const MiningTrendChart = ({color = 'var(--reblas-btn1-color)', points}: MiningTrendChartProps) => {
  const series = useMemo<Props['series']>(
    () => [
      {
        name: 'Price',
        data: points.map((point) => point.value),
      },
    ],
    [points]
  );

  const options = useMemo<Props['options']>(
    () => ({
      chart: {
        type: 'area',
        toolbar: {show: false},
        zoom: {enabled: false},
        foreColor: 'rgba(255,255,255,0.72)',
        fontFamily: 'inherit',
      },
      colors: [color],
      dataLabels: {enabled: false},
      stroke: {
        curve: 'smooth',
        width: 3,
      },
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.32,
          opacityTo: 0.04,
          stops: [0, 95, 100],
        },
      },
      grid: {
        borderColor: 'rgba(255,255,255,0.08)',
        strokeDashArray: 4,
      },
      xaxis: {
        categories: points.map((point) => point.label),
        labels: {
          rotate: -30,
          trim: true,
          hideOverlappingLabels: true,
          style: {
            colors: 'rgba(255,255,255,0.58)',
            fontSize: '11px',
          },
        },
        axisBorder: {color: 'rgba(255,255,255,0.08)'},
        axisTicks: {color: 'rgba(255,255,255,0.08)'},
      },
      yaxis: {
        labels: {
          formatter: (value) => `$${Math.round(Number(value || 0)).toLocaleString()}`,
          style: {
            colors: 'rgba(255,255,255,0.58)',
            fontSize: '11px',
          },
        },
      },
      tooltip: {
        theme: 'dark',
        y: {
          formatter: (value) => `$${Math.round(Number(value || 0)).toLocaleString()}`,
        },
      },
      markers: {
        size: 4,
        strokeWidth: 0,
        hover: {
          sizeOffset: 2,
        },
      },
      noData: {
        text: 'No prices yet',
        align: 'center',
        verticalAlign: 'middle',
        style: {
          color: 'rgba(255,255,255,0.58)',
        },
      },
    }),
    [color, points]
  );

  return <Chart type="area" height={300} series={series} options={options} />;
};
